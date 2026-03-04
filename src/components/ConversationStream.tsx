import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../store';
import { Node, Branch } from '../types';
import { Send, GitBranch, ArrowUpCircle, CornerUpLeft, Eye, EyeOff, Save, CheckCircle2, Circle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import clsx from 'clsx';
import { generateResponseStream, generateMainlineSummary, extractPattern, detectBranchSuggestion } from '../services/gemini';

type PendingBranchSuggestion = {
  anchorNodeId: string;
  reason: string;
  nodeIdsToMove: string[];
};

export default function ConversationStream() {
  const { 
    projects, activeProjectId, nodes, branches, mainlines, contexts, patterns,
    addNode, createBranch, acceptSuggestedBranch, promoteBranch, returnToMainline, toggleNodeInclusion,
    updateBranchSummary, createPattern, setActivePattern, setActiveStep, batchToggleInclusion, updateNodeContent
  } = useAppStore();
  
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isExtractingPattern, setIsExtractingPattern] = useState(false);
  const [pendingBranchSuggestion, setPendingBranchSuggestion] = useState<PendingBranchSuggestion | null>(null);
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  
  // Selection state
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const handleLocate = (e: Event) => {
      const customEvent = e as CustomEvent;
      const nodeId = customEvent.detail.nodeId;
      const element = document.getElementById(`node-${nodeId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('ring-4', 'ring-indigo-500', 'ring-offset-2', 'rounded-2xl', 'transition-all', 'duration-500');
        setTimeout(() => {
          element.classList.remove('ring-4', 'ring-indigo-500', 'ring-offset-2', 'rounded-2xl');
        }, 2000);
      }
    };
    window.addEventListener('locate-node', handleLocate);
    return () => window.removeEventListener('locate-node', handleLocate);
  }, []);

  const project = activeProjectId ? projects[activeProjectId] : null;
  const context = project ? contexts[project.active_context_id] : null;

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [nodes, context?.base_path]);

  // Generate branch summary when entering a new branch
  useEffect(() => {
    if (!project || !context) return;
    const isMainline = context.base_path === 'mainline';
    if (!isMainline) {
      const currentBranch = branches[context.base_path];
      if (currentBranch && !currentBranch.mainline_summary) {
        const mainlineNodeIds = mainlines[project.project_id] || [];
        const anchorIndex = mainlineNodeIds.indexOf(currentBranch.anchor_node_id);
        const baseNodes = anchorIndex !== -1 
          ? mainlineNodeIds.slice(0, anchorIndex + 1).map(id => nodes[id]).filter(Boolean)
          : [];
        
        if (baseNodes.length > 0) {
          generateMainlineSummary(baseNodes).then(summary => {
            updateBranchSummary(currentBranch.branch_id, summary);
          });
        }
      }
    }
  }, [project?.project_id, context?.base_path]);

  if (!project || !context) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-400 bg-white">
        Select or create a project to start.
      </div>
    );
  }

  const isMainline = context.base_path === 'mainline';
  const currentBranch = !isMainline ? branches[context.base_path] : null;

  useEffect(() => {
    if (!isMainline && pendingBranchSuggestion) {
      setPendingBranchSuggestion(null);
    }
  }, [isMainline, pendingBranchSuggestion]);

  const rawMainlineNodeIds = mainlines[project.project_id] || [];
  const validMainlineNodeIds = rawMainlineNodeIds.filter((id) => nodes[id]?.project_id === project.project_id);
  const fallbackMainlineNodeIds = Object.values(nodes)
    .filter((n) => n.project_id === project.project_id && n.branch_id === null)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((n) => n.node_id);
  const resolvedMainlineNodeIds =
    validMainlineNodeIds.length > 0 ? validMainlineNodeIds : fallbackMainlineNodeIds;

  useEffect(() => {
    if (rawMainlineNodeIds.length > 0 && validMainlineNodeIds.length === 0) {
      console.warn('[conversation-mainline] invalid mainline ids detected', {
        projectId: project.project_id,
        rawMainlineCount: rawMainlineNodeIds.length,
      });
    }
    if (rawMainlineNodeIds.length === 0 && fallbackMainlineNodeIds.length > 0) {
      console.warn('[conversation-mainline] empty mainline; using fallback for rendering only', {
        projectId: project.project_id,
        fallbackCount: fallbackMainlineNodeIds.length,
      });
    }
  }, [project.project_id, rawMainlineNodeIds.length, validMainlineNodeIds.length, fallbackMainlineNodeIds.length]);

  // Compute the visible nodes based on the base_path
  let visibleNodes: Node[] = [];
  if (isMainline) {
    visibleNodes = resolvedMainlineNodeIds.map(id => nodes[id]).filter(Boolean);
  } else if (currentBranch) {
    const anchorIndex = resolvedMainlineNodeIds.indexOf(currentBranch.anchor_node_id);
    const baseNodes = anchorIndex !== -1 
      ? resolvedMainlineNodeIds.slice(0, anchorIndex + 1).map(id => nodes[id])
      : [];
    
    const branchNodes = Object.values(nodes)
      .filter(n => n.branch_id === currentBranch.branch_id)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
    visibleNodes = [...baseNodes, ...branchNodes].filter(Boolean);
  }

  const effectiveNodes = visibleNodes.filter(n => !context.excluded_nodes.includes(n.node_id));
  const includedExtraNodes = context.included_nodes.map(id => nodes[id]).filter(Boolean);
  
  const allEffectiveNodes = [...new Set([...effectiveNodes, ...includedExtraNodes])]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    if (pendingBranchSuggestion) {
      setPendingBranchSuggestion(null);
    }

    const userMsg = input.trim();
    setInput('');
    setIsLoading(true);

    const stateBeforeSend = useAppStore.getState();
    const liveProject = stateBeforeSend.projects[project.project_id];
    const liveContext = liveProject ? stateBeforeSend.contexts[liveProject.active_context_id] : null;
    const liveIsMainline = liveContext?.base_path === 'mainline';
    const liveBranch = !liveIsMainline && liveContext ? stateBeforeSend.branches[liveContext.base_path] : null;
    const liveRawMainline = stateBeforeSend.mainlines[project.project_id] || [];
    const liveValidMainline = liveRawMainline.filter((id) => stateBeforeSend.nodes[id]?.project_id === project.project_id);
    const liveFallbackMainline = Object.values(stateBeforeSend.nodes)
      .filter((n) => n.project_id === project.project_id && n.branch_id === null)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((n) => n.node_id);
    const liveResolvedMainline = liveValidMainline.length > 0 ? liveValidMainline : liveFallbackMainline;

    const liveVisibleNodes: Node[] = liveIsMainline
      ? liveResolvedMainline.map((id) => stateBeforeSend.nodes[id]).filter(Boolean)
      : liveBranch
      ? [
          ...(() => {
            const anchorIndex = liveResolvedMainline.indexOf(liveBranch.anchor_node_id);
            return anchorIndex !== -1
              ? liveResolvedMainline.slice(0, anchorIndex + 1).map((id) => stateBeforeSend.nodes[id]).filter(Boolean)
              : [];
          })(),
          ...Object.values(stateBeforeSend.nodes)
            .filter((n) => n.branch_id === liveBranch.branch_id)
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
        ]
      : [];

    const parentId = liveVisibleNodes.length > 0 ? liveVisibleNodes[liveVisibleNodes.length - 1].node_id : null;
    const branchId = liveIsMainline ? null : liveBranch?.branch_id || null;
    const shouldDetectBranch = !!liveIsMainline && !!parentId;

    console.debug('[send-context]', {
      projectId: project.project_id,
      basePath: liveContext?.base_path ?? 'unknown',
      parentId,
      parentBranchId: parentId ? stateBeforeSend.nodes[parentId]?.branch_id ?? null : null,
      branchId,
      visibleCount: liveVisibleNodes.length,
    });

    const branchDetectionPromise = shouldDetectBranch
      ? detectBranchSuggestion(liveVisibleNodes, userMsg)
      : Promise.resolve(null);

    const userNodeId = addNode(project.project_id, parentId, 'user', userMsg, branchId);
    const assistantNodeId = addNode(project.project_id, userNodeId, 'assistant', '', branchId);

    const repairMainlineIfNeeded = () => {
      const state = useAppStore.getState();
      const currentMainline = state.mainlines[project.project_id] || [];
      const validMainline = currentMainline.filter((id) => state.nodes[id]?.project_id === project.project_id);

      if (validMainline.length !== currentMainline.length) {
        if (validMainline.length === 0) {
          console.warn('[mainline-repair] skipped destructive rewrite for empty sanitized mainline', {
            projectId: project.project_id,
            currentMainlineLength: currentMainline.length,
          });
          return;
        }

        useAppStore.setState((prev) => ({
          mainlines: {
            ...prev.mainlines,
            [project.project_id]: validMainline,
          },
        }));
      }
    };

    try {
      let systemPrompt = "You are assisting in a structured conversational computation. Main Objective: Help the user.";
      if (!isMainline && currentBranch) {
        systemPrompt = `You are executing a Subtask branch. Branched from node ${currentBranch.anchor_node_id}.`;
        if (currentBranch.mainline_summary) {
          systemPrompt += `\n\n[CURRENT CONTEXT STATUS]:\n- Main Task Summary: ${currentBranch.mainline_summary}\n- Current State: You are currently executing a Subtask branch.`;
        }
      }
      
      const activePattern = context.active_pattern ? patterns[context.active_pattern] : null;

      const responseText = await generateResponseStream(
        systemPrompt,
        allEffectiveNodes,
        userMsg,
        activePattern,
        (delta) => updateNodeContent(assistantNodeId, delta, 'append'),
        context.active_step_index
      );
      const currentAssistantContent = useAppStore.getState().nodes[assistantNodeId]?.content ?? '';
      if (!responseText && !currentAssistantContent.trim()) {
        updateNodeContent(assistantNodeId, 'No response generated.', 'replace');
      }
      
      // Auto-advance step if pattern is active
      if (activePattern && context.active_step_index !== undefined) {
        if (context.active_step_index < activePattern.steps.length - 1) {
          setActiveStep(project.project_id, context.active_step_index + 1);
        }
      }
      repairMainlineIfNeeded();
    } catch (error) {
      console.error(error);
      const currentAssistantContent = useAppStore.getState().nodes[assistantNodeId]?.content ?? '';
      if (!currentAssistantContent.trim()) {
        updateNodeContent(assistantNodeId, 'Error generating response. Check console.', 'replace');
      }
      repairMainlineIfNeeded();
    } finally {
      const branchDecision = await branchDetectionPromise;
      if (branchDecision?.shouldBranch && parentId) {
        const state = useAppStore.getState();
        const activeContextId = state.projects[project.project_id]?.active_context_id;
        const activeContext = activeContextId ? state.contexts[activeContextId] : null;
        if (activeContext?.base_path === 'mainline') {
          setPendingBranchSuggestion({
            anchorNodeId: parentId,
            reason: branchDecision.reason || 'This looks like a temporary or off-topic subtask.',
            nodeIdsToMove: [userNodeId, assistantNodeId],
          });
        }
      }
      setIsLoading(false);
    }
  };

  const handleReBranch = (nodeId: string) => {
    createBranch(project.project_id, nodeId);
  };

  const handleAcceptBranchSuggestion = () => {
    if (!pendingBranchSuggestion) return;
    const createdBranchId = acceptSuggestedBranch(
      project.project_id,
      pendingBranchSuggestion.anchorNodeId,
      pendingBranchSuggestion.nodeIdsToMove
    );
    if (!createdBranchId) {
      console.warn('[branch-accept] no nodes moved for suggested branch', {
        projectId: project.project_id,
        anchorNodeId: pendingBranchSuggestion.anchorNodeId,
      });
    }
    setPendingBranchSuggestion(null);
  };

  const handleNodeClick = (e: React.MouseEvent, nodeId: string) => {
    if (e.shiftKey && lastSelectedId) {
      // Range selection
      const startIndex = visibleNodes.findIndex(n => n.node_id === lastSelectedId);
      const endIndex = visibleNodes.findIndex(n => n.node_id === nodeId);
      if (startIndex !== -1 && endIndex !== -1) {
        const start = Math.min(startIndex, endIndex);
        const end = Math.max(startIndex, endIndex);
        const newSelection = new Set(selectedNodeIds);
        for (let i = start; i <= end; i++) {
          newSelection.add(visibleNodes[i].node_id);
        }
        setSelectedNodeIds(newSelection);
      }
    } else if (e.metaKey || e.ctrlKey) {
      // Toggle single
      const newSelection = new Set(selectedNodeIds);
      if (newSelection.has(nodeId)) {
        newSelection.delete(nodeId);
      } else {
        newSelection.add(nodeId);
      }
      setSelectedNodeIds(newSelection);
      setLastSelectedId(nodeId);
    } else {
      // Clear selection if clicking without modifiers
      if (selectedNodeIds.size > 0) {
        setSelectedNodeIds(new Set());
        setLastSelectedId(null);
      }
    }
  };

  const handleSavePattern = async () => {
    if (selectedNodeIds.size === 0) return;
    setIsExtractingPattern(true);
    try {
      const selectedNodes = visibleNodes.filter(n => selectedNodeIds.has(n.node_id));
      const { name, guidance_text, steps } = await extractPattern(selectedNodes);
      const fromId = selectedNodes[0].node_id;
      const toId = selectedNodes[selectedNodes.length - 1].node_id;
      const patternId = createPattern(project.project_id, name, fromId, toId, guidance_text, steps);
      setActivePattern(project.project_id, patternId);
      setSelectedNodeIds(new Set());
    } catch (error) {
      console.error(error);
      alert('Failed to extract pattern.');
    } finally {
      setIsExtractingPattern(false);
    }
  };

  const activePattern = context.active_pattern ? patterns[context.active_pattern] : null;

  return (
    <div className="flex-1 flex flex-col h-full bg-white relative">
      {/* Top Status Bar for Branch Mode */}
      {!isMainline && currentBranch && (
        <div className="bg-indigo-50 border-b border-indigo-100 p-3 flex items-center justify-between shadow-sm z-10">
          <div className="flex items-center gap-2 text-indigo-800 font-medium text-sm">
            <GitBranch size={16} />
            <span>Subtask Active</span>
            <span className="text-indigo-500 text-xs ml-2 truncate max-w-[200px]">
              Branched from {nodes[currentBranch.anchor_node_id]?.content.substring(0, 20)}...
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => returnToMainline(project.project_id)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-100 hover:bg-indigo-200 rounded-md transition-colors"
            >
              <CornerUpLeft size={14} />
              Return to Mainline
            </button>
            <button
              onClick={() => promoteBranch(project.project_id, currentBranch.branch_id)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors"
            >
              <ArrowUpCircle size={14} />
              Promote Branch
            </button>
          </div>
        </div>
      )}

      {/* Selection Action Bar */}
      {selectedNodeIds.size > 0 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-zinc-900 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-4 z-20">
          <span className="text-sm font-medium">{selectedNodeIds.size} selected</span>
          <div className="h-4 w-px bg-zinc-700" />
          <button 
            onClick={() => {
              batchToggleInclusion(project.project_id, Array.from(selectedNodeIds), 'exclude');
              setSelectedNodeIds(new Set());
            }}
            className="text-sm hover:text-red-400 transition-colors flex items-center gap-1"
          >
            <EyeOff size={14} /> Exclude
          </button>
          <button 
            onClick={() => {
              batchToggleInclusion(project.project_id, Array.from(selectedNodeIds), 'include');
              setSelectedNodeIds(new Set());
            }}
            className="text-sm hover:text-emerald-400 transition-colors flex items-center gap-1"
          >
            <Eye size={14} /> Include
          </button>
          <div className="h-4 w-px bg-zinc-700" />
          <button 
            onClick={handleSavePattern}
            disabled={isExtractingPattern}
            className="text-sm hover:text-indigo-400 transition-colors flex items-center gap-1 disabled:opacity-50"
          >
            <Save size={14} /> {isExtractingPattern ? 'Extracting...' : 'Save as Pattern'}
          </button>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6" onClick={() => { if(selectedNodeIds.size > 0) setSelectedNodeIds(new Set()) }}>
        {visibleNodes.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-zinc-400 space-y-4">
            <div className="w-16 h-16 rounded-full bg-zinc-100 flex items-center justify-center">
              <Send size={24} className="text-zinc-300" />
            </div>
            <p>Start the conversation...</p>
          </div>
        ) : (
          visibleNodes.map((node) => {
            const isExcluded = context.excluded_nodes.includes(node.node_id);
            const isSelected = selectedNodeIds.has(node.node_id);
            const inlineSuggestionTargetNodeId = pendingBranchSuggestion?.nodeIdsToMove[1];
            const showInlineSuggestion =
              isMainline &&
              !!pendingBranchSuggestion &&
              node.role === 'assistant' &&
              inlineSuggestionTargetNodeId === node.node_id;
            return (
              <div
                key={node.node_id}
                id={`node-${node.node_id}`}
                onClick={(e) => { e.stopPropagation(); handleNodeClick(e, node.node_id); }}
                className={clsx(
                  "flex flex-col max-w-3xl mx-auto group cursor-pointer transition-all",
                  node.role === 'user' ? "items-end" : "items-start",
                  isExcluded && "opacity-40",
                  isSelected && "ring-2 ring-indigo-500 ring-offset-2 rounded-2xl"
                )}
              >
                <div className={clsx("flex items-center gap-2 mb-1 px-1", node.role === 'user' && "flex-row-reverse")}>
                  <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    {node.role}
                  </span>
                  {isExcluded && (
                    <span className="text-[10px] bg-zinc-200 text-zinc-600 px-1.5 py-0.5 rounded-sm">
                      Excluded from Context
                    </span>
                  )}
                  {/* Re-branch button (visible on hover) */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleReBranch(node.node_id); }}
                    className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-indigo-600 transition-all text-xs flex items-center gap-1"
                    title="Re-Branch from Here"
                  >
                    <GitBranch size={12} />
                    Branch
                  </button>
                  {/* Exclude/Include button (visible on hover) */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleNodeInclusion(project.project_id, node.node_id); }}
                    className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 transition-all text-xs flex items-center gap-1"
                    title={isExcluded ? "Include in Context" : "Exclude from Context"}
                  >
                    {isExcluded ? <Eye size={12} /> : <EyeOff size={12} />}
                    {isExcluded ? "Include" : "Exclude"}
                  </button>
                </div>
                <div
                  className={clsx(
                    "px-5 py-3.5 rounded-2xl shadow-sm max-w-[85%] text-[15px] leading-relaxed",
                    node.role === 'user'
                      ? "bg-zinc-900 text-zinc-50 rounded-tr-sm"
                      : node.role === 'system'
                      ? "bg-red-50 text-red-900 border border-red-100 rounded-tl-sm"
                      : "bg-white border border-zinc-200 text-zinc-800 rounded-tl-sm"
                  )}
                >
                  {node.role === 'assistant' && node.content.trim() === '' ? (
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  ) : (
                    <div className="markdown-body prose prose-sm max-w-none dark:prose-invert">
                      <ReactMarkdown>{node.content}</ReactMarkdown>
                    </div>
                  )}
                  {showInlineSuggestion && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-amber-900">Suggest opening a new branch?</p>
                        <p className="text-xs text-amber-800 mt-1">{pendingBranchSuggestion.reason}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setPendingBranchSuggestion(null)}
                          className="px-3 py-1.5 rounded-md text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:bg-zinc-100 transition-colors"
                        >
                          Reject
                        </button>
                        <button
                          onClick={handleAcceptBranchSuggestion}
                          className="px-3 py-1.5 rounded-md text-xs font-medium !text-white bg-zinc-900 hover:bg-zinc-800 transition-colors"
                          style={{ color: '#fff' }}
                        >
                          Accept
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={endOfMessagesRef} />
      </div>

      {/* Pattern Guidance UI */}
      {activePattern && context.active_step_index !== undefined && (
        <div className="bg-emerald-50 border-t border-emerald-100 p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wider">
              Active Pattern: {activePattern.name}
            </span>
            <button 
              onClick={() => setActivePattern(project.project_id, null)}
              className="text-xs text-emerald-600 hover:text-emerald-800"
            >
              Clear
            </button>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {activePattern.steps.map((step, idx) => (
              <div 
                key={idx}
                className={clsx(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs whitespace-nowrap cursor-pointer transition-colors",
                  idx === context.active_step_index 
                    ? "bg-emerald-600 text-white font-medium shadow-sm"
                    : idx < context.active_step_index
                    ? "bg-emerald-200 text-emerald-800"
                    : "bg-emerald-100 text-emerald-600 hover:bg-emerald-200"
                )}
                onClick={() => setActiveStep(project.project_id, idx)}
              >
                {idx < context.active_step_index ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                Step {idx + 1}
              </div>
            ))}
          </div>
          <div className="text-sm text-emerald-900 bg-white/60 p-2 rounded-md border border-emerald-200/50">
            {activePattern.steps[context.active_step_index]}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-zinc-200">
        <form onSubmit={handleSend} className="max-w-3xl mx-auto relative flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
            placeholder="Type a message... (Shift+Enter for new line, Cmd/Ctrl+Click to select nodes)"
            className="w-full max-h-48 min-h-[56px] p-4 pr-12 bg-zinc-50 border border-zinc-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent resize-none text-[15px]"
            rows={1}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="absolute right-3 bottom-3 p-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors disabled:bg-zinc-300 disabled:text-zinc-600 disabled:cursor-not-allowed"
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}
