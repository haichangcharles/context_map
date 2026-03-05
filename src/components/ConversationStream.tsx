import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../store';
import { Node, Branch } from '../types';
import { Send, GitBranch, ArrowUpCircle, CornerUpLeft, Eye, EyeOff, Save, CheckCircle2, Circle, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import clsx from 'clsx';
import { generateResponseStream, generateMainlineSummary, extractPattern, detectBranchSuggestion } from '../services/gemini';
import { appendBranchFeedbackSample, buildQAPair, consumePendingBranchFeedback, logBranchDebug, QAPair, setPendingBranchFeedback } from '../utils/branchFeedbackDataset';
import { flushChatHistoryQueue, logChatNode } from '../services/chatHistory';

type PendingBranchSuggestion = {
  anchorNodeId: string;
  reason: string;
  nodeIdsToMove: string[];
  originBasePath: string;
};

const getBranchChainIds = (branchId: string, branches: Record<string, Branch>): string[] => {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = branchId;

  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const branch = branches[cursor];
    if (!branch) break;
    chain.push(branch.branch_id);
    cursor = branch.parent_branch_id;
  }

  return chain.reverse();
};

const resolveVisibleNodesForBasePath = (
  basePath: string,
  branchesById: Record<string, Branch>,
  nodesById: Record<string, Node>,
  resolvedMainlineIds: string[]
): Node[] => {
  if (basePath === 'mainline') {
    return resolvedMainlineIds.map((id) => nodesById[id]).filter(Boolean);
  }

  const currentBranch = branchesById[basePath];
  if (!currentBranch) {
    return resolvedMainlineIds.map((id) => nodesById[id]).filter(Boolean);
  }

  const branchChainIds = getBranchChainIds(currentBranch.branch_id, branchesById);
  const rootBranchId = branchChainIds[0];
  const rootBranch = rootBranchId ? branchesById[rootBranchId] : null;
  let anchorIndex = rootBranch ? resolvedMainlineIds.indexOf(rootBranch.anchor_node_id) : -1;

  if (anchorIndex === -1 && rootBranch) {
    const anchorNode = nodesById[rootBranch.anchor_node_id];
    if (anchorNode && anchorNode.branch_id === null) {
      const projectMainlineNodes = Object.values(nodesById)
        .filter((n) => n.project_id === anchorNode.project_id && n.branch_id === null)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      anchorIndex = projectMainlineNodes.findIndex((n) => n.node_id === rootBranch.anchor_node_id);
      if (anchorIndex !== -1) {
        const recoveredBaseIds = projectMainlineNodes.slice(0, anchorIndex + 1).map((n) => n.node_id);
        const baseNodes = recoveredBaseIds.map((id) => nodesById[id]).filter(Boolean);
        const allNodes = Object.values(nodesById);
        const threadedBranchNodes: Node[] = [];

        branchChainIds.forEach((branchId, idx) => {
          const segmentNodes = allNodes
            .filter((n) => n.branch_id === branchId)
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          const nextBranchId = branchChainIds[idx + 1];
          if (!nextBranchId) { threadedBranchNodes.push(...segmentNodes); return; }
          const nextAnchorNodeId = branchesById[nextBranchId]?.anchor_node_id;
          const cutoffIndex = nextAnchorNodeId ? segmentNodes.findIndex((n) => n.node_id === nextAnchorNodeId) : -1;
          if (cutoffIndex === -1) { threadedBranchNodes.push(...segmentNodes); return; }
          threadedBranchNodes.push(...segmentNodes.slice(0, cutoffIndex + 1));
        });

        const dedup = new Map<string, Node>();
        [...baseNodes, ...threadedBranchNodes].forEach((n) => dedup.set(n.node_id, n));
        return Array.from(dedup.values());
      }
    }
  }

  const baseNodes = anchorIndex !== -1
    ? resolvedMainlineIds.slice(0, anchorIndex + 1).map((id) => nodesById[id]).filter(Boolean)
    : resolvedMainlineIds.map((id) => nodesById[id]).filter(Boolean);

  const allNodes = Object.values(nodesById);
  const threadedBranchNodes: Node[] = [];

  branchChainIds.forEach((branchId, idx) => {
    const segmentNodes = allNodes
      .filter((n) => n.branch_id === branchId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const nextBranchId = branchChainIds[idx + 1];
    if (!nextBranchId) {
      threadedBranchNodes.push(...segmentNodes);
      return;
    }

    const nextAnchorNodeId = branchesById[nextBranchId]?.anchor_node_id;
    const cutoffIndex = nextAnchorNodeId ? segmentNodes.findIndex((n) => n.node_id === nextAnchorNodeId) : -1;
    if (cutoffIndex === -1) {
      threadedBranchNodes.push(...segmentNodes);
      return;
    }

    threadedBranchNodes.push(...segmentNodes.slice(0, cutoffIndex + 1));
  });

  const dedup = new Map<string, Node>();
  [...baseNodes, ...threadedBranchNodes].forEach((n) => dedup.set(n.node_id, n));
  return Array.from(dedup.values());
};

const summarizeRecent = (items: string[], max = 160): string => {
  const merged = items
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-2)
    .join(' | ');
  return merged.slice(0, max);
};

const getStreamCharLimit = (): number => {
  const raw = Number(import.meta.env.VITE_MAX_STREAM_CHARS || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
};

const getCurrentLevel = (isMainline: boolean, currentBranch: Branch | null, allBranches: Record<string, Branch>): number => {
  if (isMainline || !currentBranch) return 1;
  return getBranchChainIds(currentBranch.branch_id, allBranches).length + 1;
};

const buildQAPairsFromOrderedNodes = (orderedNodes: Node[]): QAPair[] => {
  const byParent = new Map<string, Node[]>();
  orderedNodes.forEach((node) => {
    if (!node.parent_id) return;
    if (!byParent.has(node.parent_id)) byParent.set(node.parent_id, []);
    byParent.get(node.parent_id)!.push(node);
  });

  return orderedNodes
    .filter((n) => n.role === 'user')
    .map((userNode) => {
      const assistantChild = (byParent.get(userNode.node_id) || []).find((n) => n.role === 'assistant');
      return buildQAPair(userNode, assistantChild || null);
    })
    .filter((pair) => pair.user || pair.assistant);
};

export default function ConversationStream() {
  const { 
    projects, activeProjectId, nodes, branches, mainlines, contexts, patterns,
    addNode, createBranch, acceptSuggestedBranch, promoteBranch, returnToMainline, returnToParentBranch, toggleNodeInclusion,
    updateBranchSummary, createPattern, setActivePattern, setActiveStep, batchToggleInclusion, updateNodeContent
  } = useAppStore();
  
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isExtractingPattern, setIsExtractingPattern] = useState(false);
  const [pendingBranchSuggestion, setPendingBranchSuggestion] = useState<PendingBranchSuggestion | null>(null);
  const [branchSuggestionNotice, setBranchSuggestionNotice] = useState<string | null>(null);
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const wasAutoTruncatedRef = useRef(false);
  const wasManuallyTruncatedRef = useRef(false);
  
  // Selection state
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  const handleTruncateOutput = () => {
    if (!isLoading) return;
    wasManuallyTruncatedRef.current = true;
    streamAbortRef.current?.abort();
  };

  useEffect(() => {
    void flushChatHistoryQueue();
  }, []);

  useEffect(() => () => {
    streamAbortRef.current?.abort();
  }, []);

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

  const isMainline = context?.base_path === 'mainline';
  const currentBranch = !isMainline && context ? branches[context.base_path] : null;

  useEffect(() => {
    if (!pendingBranchSuggestion) return;
    if (!context) return;
    if (context.base_path !== pendingBranchSuggestion.originBasePath) {
      setPendingBranchSuggestion(null);
    }
  }, [context?.base_path, pendingBranchSuggestion]);

  useEffect(() => {
    if (!branchSuggestionNotice) return;
    const timer = window.setTimeout(() => setBranchSuggestionNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [branchSuggestionNotice]);

  const rawMainlineNodeIds = project ? mainlines[project.project_id] || [] : [];
  const validMainlineNodeIds = project
    ? rawMainlineNodeIds.filter((id) => nodes[id]?.project_id === project.project_id)
    : [];
  const fallbackMainlineNodeIds = project
    ? Object.values(nodes)
        .filter((n) => n.project_id === project.project_id && n.branch_id === null)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .map((n) => n.node_id)
    : [];
  const resolvedMainlineNodeIds = (() => {
    if (!project) return [];
    if (validMainlineNodeIds.length > 0) return validMainlineNodeIds;
    if (fallbackMainlineNodeIds.length > 0) return fallbackMainlineNodeIds;
    const allProjectNodeIds = Object.values(nodes)
      .filter((n) => n.project_id === project.project_id)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((n) => n.node_id);
    if (allProjectNodeIds.length > 0) {
      console.warn('[conversation-mainline] fallback to earliest project node', {
        projectId: project.project_id,
        totalProjectNodes: allProjectNodeIds.length,
      });
      return [allProjectNodeIds[0]];
    }
    return [];
  })();

  useEffect(() => {
    if (!project) return;
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
  }, [project?.project_id, rawMainlineNodeIds.length, validMainlineNodeIds.length, fallbackMainlineNodeIds.length]);

  if (!project || !context) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-400 bg-white">
        Select or create a project to start.
      </div>
    );
  }

  // Compute the visible nodes based on the base_path
  let visibleNodes: Node[] = [];
  if (isMainline) {
    visibleNodes = resolvedMainlineNodeIds.map(id => nodes[id]).filter(Boolean);
  } else if (currentBranch) {
    visibleNodes = resolveVisibleNodesForBasePath(
      currentBranch.branch_id,
      branches,
      nodes,
      resolvedMainlineNodeIds
    );
  }

  const effectiveNodes = visibleNodes.filter(n => !context.excluded_nodes.includes(n.node_id));
  const includedExtraNodes = context.included_nodes.map(id => nodes[id]).filter(Boolean);
  
  const allEffectiveNodes = [...new Set([...effectiveNodes, ...includedExtraNodes])]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const buildSuggestionSnapshot = () => {
    const state = useAppStore.getState();
    const liveProject = state.projects[project.project_id];
    const liveContext = liveProject ? state.contexts[liveProject.active_context_id] : null;
    if (!liveContext) return null;

    const projectNodes = Object.values(state.nodes)
      .filter((n) => n.project_id === project.project_id)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const rawMainline = state.mainlines[project.project_id] || [];
    const validMainline = rawMainline.filter((id) => state.nodes[id]?.project_id === project.project_id);
    const fallbackMainline = projectNodes.filter((n) => n.branch_id === null).map((n) => n.node_id);
    const resolvedMainline = validMainline.length > 0
      ? validMainline
      : fallbackMainline.length > 0
        ? fallbackMainline
        : (projectNodes[0] ? [projectNodes[0].node_id] : []);
    const visibleForBasePath = resolveVisibleNodesForBasePath(
      liveContext.base_path,
      state.branches,
      state.nodes,
      resolvedMainline
    );

    return {
      projectId: project.project_id,
      basePath: liveContext.base_path,
      projectNodeCount: projectNodes.length,
      mainlineLength: rawMainline.length,
      validMainlineLength: validMainline.length,
      resolvedMainlineLength: resolvedMainline.length,
      visibleNodeCount: visibleForBasePath.length,
      latestNodeIds: projectNodes.slice(-5).map((n) => n.node_id),
    };
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    if (pendingBranchSuggestion) {
      const movedUser = nodes[pendingBranchSuggestion.nodeIdsToMove[0]];
      const movedAssistant = nodes[pendingBranchSuggestion.nodeIdsToMove[1]];
      const historyPairs = buildQAPairsFromOrderedNodes(visibleNodes).slice(-3);
      const currentTLDR = !isMainline && currentBranch
        ? currentBranch.intent_summary || currentBranch.parent_context_tldr || summarizeRecent(visibleNodes.map((n) => n.content), 160)
        : summarizeRecent(visibleNodes.map((n) => n.content), 160);

      const ignoreLevel = getCurrentLevel(isMainline, currentBranch, branches);
      appendBranchFeedbackSample({
        current_tldr: currentTLDR,
        history_last_3_qa: historyPairs,
        current_node: buildQAPair(movedUser, movedAssistant),
        level: ignoreLevel,
        user_behaviour: 'same_thread',
        behaviour_source: 'ignore_branch',
        time: new Date().toISOString(),
      });
      logBranchDebug('dataset-append', {
        source: 'ignore_branch',
        userBehaviour: 'same_thread',
        level: ignoreLevel,
      });
      setPendingBranchSuggestion(null);
    }

    const userMsg = input.trim();
    setInput('');
    setIsLoading(true);
    wasAutoTruncatedRef.current = false;
    wasManuallyTruncatedRef.current = false;
    const streamAbortController = new AbortController();
    streamAbortRef.current = streamAbortController;

    const stateBeforeSend = useAppStore.getState();
    const liveProject = stateBeforeSend.projects[project.project_id];
    const liveContext = liveProject ? stateBeforeSend.contexts[liveProject.active_context_id] : null;
    if (liveContext) {
      const pendingCommitted = consumePendingBranchFeedback(liveContext.base_path);
      if (pendingCommitted) {
        appendBranchFeedbackSample(pendingCommitted);
        logBranchDebug('dataset-append', {
          source: pendingCommitted.behaviour_source,
          userBehaviour: pendingCommitted.user_behaviour,
          level: pendingCommitted.level,
          commitMode: 'on-first-message',
          basePath: liveContext.base_path,
        });
      }
    }

    const liveIsMainline = liveContext?.base_path === 'mainline';
    const liveBranch = !liveIsMainline && liveContext ? stateBeforeSend.branches[liveContext.base_path] : null;
    const liveRawMainline = stateBeforeSend.mainlines[project.project_id] || [];
    const liveValidMainline = liveRawMainline.filter((id) => stateBeforeSend.nodes[id]?.project_id === project.project_id);
    const liveFallbackMainline = Object.values(stateBeforeSend.nodes)
      .filter((n) => n.project_id === project.project_id && n.branch_id === null)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((n) => n.node_id);
    const liveResolvedMainline = liveValidMainline.length > 0 ? liveValidMainline : liveFallbackMainline;

    const liveVisibleNodes: Node[] = !liveContext
      ? []
      : resolveVisibleNodesForBasePath(
          liveContext.base_path,
          stateBeforeSend.branches,
          stateBeforeSend.nodes,
          liveResolvedMainline
        );

    const liveBranchChainIds = liveBranch ? getBranchChainIds(liveBranch.branch_id, stateBeforeSend.branches) : [];
    const liveBranchDepth = liveBranchChainIds.length;
    const projectBranches = Object.values(stateBeforeSend.branches).filter((b) => b.project_id === project.project_id);
    const totalBranchCount = projectBranches.length;
    const activeBranchCount = projectBranches.filter((b) => b.status === 'active').length;
    const recentBranchIntents = projectBranches
      .sort((a, b) => {
        const aAnchorTs = stateBeforeSend.nodes[a.anchor_node_id]?.timestamp || '';
        const bAnchorTs = stateBeforeSend.nodes[b.anchor_node_id]?.timestamp || '';
        return new Date(bAnchorTs).getTime() - new Date(aAnchorTs).getTime();
      })
      .map((b) => b.intent_summary || b.mainline_summary || stateBeforeSend.nodes[b.anchor_node_id]?.content || '')
      .filter(Boolean)
      .slice(0, 3);
    const mainlineNodes = liveResolvedMainline.map((id) => stateBeforeSend.nodes[id]).filter(Boolean);
    const mainlineTLDR = summarizeRecent(mainlineNodes.map((n) => n.content), 180);
    const currentBranchIntent = liveBranch?.intent_summary || summarizeRecent(liveVisibleNodes.map((n) => n.content), 140);
    const parentContextTLDR =
      liveBranch?.parent_context_tldr ||
      (liveBranchDepth >= 2
        ? (() => {
            const parentId = liveBranch.parent_branch_id;
            const parentBranch = parentId ? stateBeforeSend.branches[parentId] : null;
            return parentBranch?.intent_summary || parentBranch?.mainline_summary || '';
          })()
        : mainlineTLDR);

    const parentId = liveVisibleNodes.length > 0 ? liveVisibleNodes[liveVisibleNodes.length - 1].node_id : null;
    const branchId = liveIsMainline ? null : liveBranch?.branch_id || null;
    const firstCurrentBranchNodeId = liveBranch
      ? Object.values(stateBeforeSend.nodes)
          .filter((n) => n.branch_id === liveBranch.branch_id)
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0]?.node_id || null
      : null;
    const isAtBranchFirstNode = !!liveBranch && !!parentId && parentId === firstCurrentBranchNodeId;
    const shouldDetectBranch = !!parentId && !isAtBranchFirstNode;

    logBranchDebug('send-context', {
      projectId: project.project_id,
      basePath: liveContext?.base_path ?? 'unknown',
      parentId,
      parentBranchId: parentId ? stateBeforeSend.nodes[parentId]?.branch_id ?? null : null,
      branchId,
      visibleCount: liveVisibleNodes.length,
      branchDepth: liveBranchDepth,
      totalBranchCount,
      activeBranchCount,
      isAtBranchFirstNode,
    });

    const branchDetectionPromise = shouldDetectBranch
      ? detectBranchSuggestion(liveVisibleNodes, userMsg, {
          currentMode: liveIsMainline ? 'mainline' : 'branch',
          branchDepth: liveBranchDepth,
          currentBranchIntent,
          parentContextTLDR,
          mainlineTLDR,
          totalBranchCount,
          activeBranchCount,
          recentBranchIntents,
        })
      : Promise.resolve(null);

    const userNodeId = addNode(project.project_id, parentId, 'user', userMsg, branchId);
    const assistantNodeId = addNode(project.project_id, userNodeId, 'assistant', '', branchId);
    const persistedUserNode = useAppStore.getState().nodes[userNodeId];
    if (persistedUserNode) {
      void logChatNode(persistedUserNode);
    }

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
        context.active_step_index,
        {
          maxChars: getStreamCharLimit(),
          signal: streamAbortController.signal,
          onTruncated: () => {
            wasAutoTruncatedRef.current = true;
          },
        }
      );
      const currentAssistantContent = useAppStore.getState().nodes[assistantNodeId]?.content ?? '';
      if (!responseText && !currentAssistantContent.trim()) {
        updateNodeContent(assistantNodeId, 'No response generated.', 'replace');
      } else if (wasAutoTruncatedRef.current) {
        updateNodeContent(assistantNodeId, '\n\n[输出已自动截断，可直接继续提问。]', 'append');
      }
      
      // Auto-advance step if pattern is active
      if (activePattern && context.active_step_index !== undefined) {
        if (context.active_step_index < activePattern.steps.length - 1) {
          setActiveStep(project.project_id, context.active_step_index + 1);
        }
      }
      repairMainlineIfNeeded();
    } catch (error) {
      const isAbortError =
        error instanceof DOMException
          ? error.name === 'AbortError'
          : typeof error === 'object' &&
            error !== null &&
            'name' in error &&
            (error as { name?: string }).name === 'AbortError';
      if (!isAbortError) {
        console.error(error);
      }
      const currentAssistantContent = useAppStore.getState().nodes[assistantNodeId]?.content ?? '';
      if (!currentAssistantContent.trim() && !isAbortError) {
        updateNodeContent(assistantNodeId, 'Error generating response. Check console.', 'replace');
      } else if (isAbortError && wasManuallyTruncatedRef.current && currentAssistantContent.trim()) {
        updateNodeContent(assistantNodeId, '\n\n[输出已手动截断，已按当前内容保存。]', 'append');
      }
      repairMainlineIfNeeded();
    } finally {
      streamAbortRef.current = null;
      const persistedAssistantNode = useAppStore.getState().nodes[assistantNodeId];
      if (persistedAssistantNode) {
        void logChatNode(persistedAssistantNode);
      }
      const branchDecision = await branchDetectionPromise;
      logBranchDebug('branch-decision', {
        shouldBranch: branchDecision?.shouldBranch ?? false,
        confidence: branchDecision?.confidence ?? 0,
        reason: branchDecision?.reason ?? '',
        basePath: liveContext?.base_path ?? 'unknown',
        parentId,
      });
      if (branchDecision?.shouldBranch && parentId) {
        const state = useAppStore.getState();
        const activeContextId = state.projects[project.project_id]?.active_context_id;
        const activeContext = activeContextId ? state.contexts[activeContextId] : null;
        if (activeContext?.base_path === (liveContext?.base_path ?? 'mainline')) {
          logBranchDebug('suggestion-pre-snapshot', buildSuggestionSnapshot());
          setPendingBranchSuggestion({
            anchorNodeId: parentId,
            reason: branchDecision.reason || 'This looks like a temporary or off-topic subtask.',
            nodeIdsToMove: [userNodeId, assistantNodeId],
            originBasePath: activeContext.base_path,
          });
          logBranchDebug('suggestion-created', {
            anchorNodeId: parentId,
            originBasePath: activeContext.base_path,
            nodeIdsToMove: [userNodeId, assistantNodeId],
            reason: branchDecision.reason || '',
          });
          logBranchDebug('suggestion-post-snapshot', buildSuggestionSnapshot());
        }
      }
      setIsLoading(false);
    }
  };

  const handleReBranch = (nodeId: string) => {
    const anchorNode = nodes[nodeId];
    let currentPair = buildQAPair(anchorNode, null);
    if (anchorNode?.role === 'assistant' && anchorNode.parent_id) {
      currentPair = buildQAPair(nodes[anchorNode.parent_id], anchorNode);
    } else if (anchorNode?.role === 'user') {
      const assistantChild = Object.values(nodes).find((n) => n.parent_id === anchorNode.node_id && n.role === 'assistant');
      currentPair = buildQAPair(anchorNode, assistantChild || null);
    }
    const historyPairs = buildQAPairsFromOrderedNodes(visibleNodes).slice(-3);
    const currentTLDR = !isMainline && currentBranch
      ? currentBranch.intent_summary || currentBranch.parent_context_tldr || summarizeRecent(visibleNodes.map((n) => n.content), 160)
      : summarizeRecent(visibleNodes.map((n) => n.content), 160);

    const manualLevel = getCurrentLevel(isMainline, currentBranch, branches);
    const manualSample = {
      current_tldr: currentTLDR,
      history_last_3_qa: historyPairs,
      current_node: currentPair,
      level: manualLevel,
      user_behaviour: 'branch',
      behaviour_source: 'manually_branch',
    } as const;
    logBranchDebug('dataset-pending', {
      source: 'manually_branch',
      userBehaviour: 'branch',
      level: manualLevel,
      nodeId,
    });
    const createdBranchId = createBranch(project.project_id, nodeId);
    if (createdBranchId) {
      setPendingBranchFeedback(createdBranchId, manualSample);
    }
  };

  const handleAcceptBranchSuggestion = () => {
    if (!pendingBranchSuggestion) return;
    const state = useAppStore.getState();
    const activeProject = state.projects[project.project_id];
    const activeContext = activeProject ? state.contexts[activeProject.active_context_id] : null;
    const expectedBranchId = activeContext?.base_path === 'mainline' ? null : activeContext?.base_path || null;
    const [userNodeId, assistantNodeId] = pendingBranchSuggestion.nodeIdsToMove;
    const movedUserNow = state.nodes[userNodeId];
    const movedAssistantNow = state.nodes[assistantNodeId];
    const isSuggestionStillValid =
      !!activeContext &&
      activeContext.base_path === pendingBranchSuggestion.originBasePath &&
      !!movedUserNow &&
      !!movedAssistantNow &&
      movedUserNow.project_id === project.project_id &&
      movedAssistantNow.project_id === project.project_id &&
      movedUserNow.branch_id === expectedBranchId &&
      movedAssistantNow.branch_id === expectedBranchId &&
      movedUserNow.parent_id === pendingBranchSuggestion.anchorNodeId &&
      movedAssistantNow.parent_id === movedUserNow.node_id;

    if (!isSuggestionStillValid) {
      setPendingBranchSuggestion(null);
      setBranchSuggestionNotice('Branch suggestion expired. Please regenerate.');
      return;
    }

    const movedUser = nodes[pendingBranchSuggestion.nodeIdsToMove[0]];
    const movedAssistant = nodes[pendingBranchSuggestion.nodeIdsToMove[1]];
    const historyPairs = buildQAPairsFromOrderedNodes(visibleNodes).slice(-3);
    const currentTLDR = !isMainline && currentBranch
      ? currentBranch.intent_summary || currentBranch.parent_context_tldr || summarizeRecent(visibleNodes.map((n) => n.content), 160)
      : summarizeRecent(visibleNodes.map((n) => n.content), 160);

    const acceptLevel = getCurrentLevel(isMainline, currentBranch, branches);
    const acceptSample = {
      current_tldr: currentTLDR,
      history_last_3_qa: historyPairs,
      current_node: buildQAPair(movedUser, movedAssistant),
      level: acceptLevel,
      user_behaviour: 'branch',
      behaviour_source: 'accept_branch',
    } as const;
    logBranchDebug('dataset-pending', {
      source: 'accept_branch',
      userBehaviour: 'branch',
      level: acceptLevel,
    });

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
      setBranchSuggestionNotice('Branch suggestion is stale. Please regenerate.');
    } else {
      setPendingBranchFeedback(createdBranchId, acceptSample);
    }
    setPendingBranchSuggestion(null);
  };

  const handleRejectBranchSuggestion = () => {
    if (!pendingBranchSuggestion) return;
    const movedUser = nodes[pendingBranchSuggestion.nodeIdsToMove[0]];
    const movedAssistant = nodes[pendingBranchSuggestion.nodeIdsToMove[1]];
    const historyPairs = buildQAPairsFromOrderedNodes(visibleNodes).slice(-3);
    const currentTLDR = !isMainline && currentBranch
      ? currentBranch.intent_summary || currentBranch.parent_context_tldr || summarizeRecent(visibleNodes.map((n) => n.content), 160)
      : summarizeRecent(visibleNodes.map((n) => n.content), 160);

    const rejectLevel = getCurrentLevel(isMainline, currentBranch, branches);
    appendBranchFeedbackSample({
      current_tldr: currentTLDR,
      history_last_3_qa: historyPairs,
      current_node: buildQAPair(movedUser, movedAssistant),
      level: rejectLevel,
      user_behaviour: 'same_thread',
      behaviour_source: 'reject_branch',
      time: new Date().toISOString(),
    });
    logBranchDebug('dataset-append', {
      source: 'reject_branch',
      userBehaviour: 'same_thread',
      level: rejectLevel,
    });
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
            {currentBranch.parent_branch_id && (
              <button
                onClick={() => returnToParentBranch(project.project_id)}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-white border border-indigo-200 hover:bg-indigo-50 rounded-md transition-colors"
              >
                <CornerUpLeft size={14} />
                Return to Parent
              </button>
            )}
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
        {branchSuggestionNotice && (
          <div className="max-w-3xl mx-auto mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {branchSuggestionNotice}
          </div>
        )}
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
                          onClick={handleRejectBranchSuggestion}
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
            className="w-full max-h-48 min-h-[56px] p-4 pr-24 bg-zinc-50 border border-zinc-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent resize-none text-[15px]"
            rows={1}
          />
          {isLoading && (
            <button
              type="button"
              onClick={handleTruncateOutput}
              className="absolute right-14 bottom-3 p-2 bg-amber-100 text-amber-900 rounded-lg hover:bg-amber-200 transition-colors"
              title="截断输出"
            >
              <Square size={16} />
            </button>
          )}
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
