import { useState, useRef, useEffect, useMemo } from 'react';
import { useAppStore } from '../store';
import { Node, Branch, Pattern, PatternType } from '../types';
import { Send, GitBranch, ArrowUpCircle, CornerUpLeft, Eye, EyeOff, Square, X, Check, TriangleAlert, ChevronLeft, ChevronRight, Rows3, Pencil } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import clsx from 'clsx';
import { detectStructureSuggestion, extractPatternByType, generateResponseStream, generateMainlineSummary, generateBranchSummary } from '../services/gemini';
import { appendBranchFeedbackSample, buildQAPair, consumePendingBranchFeedback, getActiveUserId, logBranchDebug, QAPair, setPendingBranchFeedback } from '../utils/branchFeedbackDataset';
import { logContextPlanProposal, readContextPlanEdits, recordContextTurnPlan } from '../utils/contextPlanEditLog';
import { flushChatHistoryQueue, logChatNode } from '../services/chatHistory';
import {
  logStructureSuggestionFeedbackEvent,
  type StructureSuggestionKind,
} from '../services/structureSuggestionFeedback';
import { buildInlineSuggestions, clampInlineSuggestionIndex } from '../utils/inlineSuggestions';
import { createChildTimestampAfter } from '../utils/messageTimestamp';
import { buildConversationSystemPrompt } from '../utils/promptBuilders';
import { buildContextGraph, compileTurnContext, proposeContextReturns, reviewContextProposal, selectStructureReadSet } from '../domain/contextSteward';
import { readContextChoices, recordContextChoice } from '../services/contextPreferenceStore';
import {
  DEFAULT_SCROLL_FOLLOW_THRESHOLD_PX,
  isNearBottom,
  shouldAutoScrollToLatest,
} from '../utils/scrollFollow';
import ConversationNodeHoverActions from './shared/ConversationNodeHoverActions';
import BranchStatusBar from './shared/BranchStatusBar';

type SuggestionFeedbackContext = {
  projectId: string;
  currentTLDR: string;
  visibleContext: QAPair[];
  historyLast3QA: QAPair[];
  currentNode: QAPair;
};

type PendingBranchSuggestion = {
  suggestionId: string;
  anchorNodeId: string;
  reason: string;
  nodeIdsToMove: string[];
  originBasePath: string;
  feedbackContext: SuggestionFeedbackContext;
  assetAction?: 'none' | 'extract_reasoning' | 'extract_task_sop';
  assetReason?: string;
  sourceNodeIds?: string[];
  assetSuggestionId?: string;
  assetShownAt?: string;
};

const logBranchPlanPhase = (
  projectId: string,
  suggestion: PendingBranchSuggestion,
  phase: 'created' | 'shown' | 'accepted' | 'rejected' | 'ignored' | 'expired'
) => {
  const state = useAppStore.getState();
  const project = state.projects[projectId];
  logContextPlanProposal({
    suggestionId: suggestion.suggestionId,
    projectId,
    context: project ? state.contexts[project.active_context_id] : undefined,
    phase,
    originBasePath: suggestion.originBasePath,
    anchorNodeId: suggestion.anchorNodeId,
    movedNodeIds: suggestion.nodeIdsToMove,
  });
};

type InlineNotice = {
  id: string;
  title: string;
  message: string;
};

type PendingStructureSuggestion = {
  targetNodeId: string;
  originBasePath: string;
  primaryAction: 'return_parent' | 'continue' | 'branch';
  assetAction: 'none' | 'extract_reasoning' | 'extract_task_sop';
  reason: string;
  assetReason: string;
  sourceNodeIds: string[];
  feedbackContext: SuggestionFeedbackContext;
  returnSuggestionId?: string;
  returnShownAt?: string;
  extractSuggestionId?: string;
  extractShownAt?: string;
  extractOriginKind?: 'structure' | 'branch_extract';
};

const createSuggestionId = () => `suggestion-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const MAX_VISIBLE_CONTEXT_PAIRS = 48;
const MAX_VISIBLE_CONTEXT_TEXT = 360;

const clipContextPair = (pair: QAPair): QAPair => ({
  user: (pair.user || '').slice(0, MAX_VISIBLE_CONTEXT_TEXT),
  assistant: (pair.assistant || '').slice(0, MAX_VISIBLE_CONTEXT_TEXT),
});

const PATTERN_TYPE_ORDER: PatternType[] = ['reasoning', 'task_sop', 'context_case'];
const PATTERN_TYPE_LABEL: Record<PatternType, string> = {
  reasoning: 'Reasoning',
  task_sop: 'Task SOP',
  context_case: 'Context Case',
};
const PATTERN_PAGE_SIZE = 5;

const buildPatternAppendix = (
  enabledByType: Partial<Record<PatternType, string>>,
  patternsById: Record<string, Pattern>
): string => {
  const lines: string[] = [];
  PATTERN_TYPE_ORDER.forEach((type) => {
    const patternId = enabledByType[type];
    if (!patternId) return;
    const pattern = patternsById[patternId];
    if (!pattern) return;
    lines.push(`[PATTERN: ${type} | ${pattern.name}]`);
    lines.push(pattern.instruction);
    if (pattern.example.trim()) {
      lines.push(`Example:\n${pattern.example}`);
    }
  });
  return lines.join('\n\n');
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

const isNodeEdited = (node: Node): boolean => !!node.metadata.edited_at;

const getStreamCharLimit = (): number => {
  const raw = Number(import.meta.env.VITE_MAX_STREAM_CHARS || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
};

const MESSAGE_BUBBLE_HORIZONTAL_PADDING = 40;

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
    updateBranchSummary, updateBranchCompletionSummary, updatePattern, approvePattern, deletePattern, createPattern,
    enablePatternForType, disablePatternForType, updateNodeContent,
    editNodeContent, batchToggleInclusion,
    isNodeSelectionMode, nodeSelectionIntent, selectedNodeIds, toggleNodeSelection
  } = useAppStore();
  
  const [input, setInput] = useState('');
  const [dismissedContextBranchIds, setDismissedContextBranchIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingBranchSuggestion, setPendingBranchSuggestion] = useState<PendingBranchSuggestion | null>(null);
  const [pendingStructureSuggestion, setPendingStructureSuggestion] = useState<PendingStructureSuggestion | null>(null);
  const [branchSuggestionNotice, setBranchSuggestionNotice] = useState<string | null>(null);
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const editingTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editingActionsRef = useRef<HTMLDivElement | null>(null);
  const wasAutoTruncatedRef = useRef(false);
  const wasManuallyTruncatedRef = useRef(false);
  const shouldAutoFollowRef = useRef(true);
  const forceScrollToLatestRef = useRef(false);
  const previousBasePathRef = useRef<string | null>(null);
  
  // Selection state
  const [viewingPatternId, setViewingPatternId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editInstruction, setEditInstruction] = useState('');
  const [editExample, setEditExample] = useState('');
  const [inlineNotice, setInlineNotice] = useState<InlineNotice | null>(null);
  const [isPatternLibraryOpen, setIsPatternLibraryOpen] = useState(false);
  const [patternPage, setPatternPage] = useState(0);
  const [structureActionInFlight, setStructureActionInFlight] = useState<'return' | 'extract' | null>(null);
  const [activeInlineSuggestionIndex, setActiveInlineSuggestionIndex] = useState(0);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [editingBubbleWidth, setEditingBubbleWidth] = useState<number | null>(null);
  const [editingActionsWidth, setEditingActionsWidth] = useState<number | null>(null);

  const handleTruncateOutput = () => {
    if (!isLoading) return;
    wasManuallyTruncatedRef.current = true;
    streamAbortRef.current?.abort();
  };

  const startEditingNode = (node: Node) => {
    if (isLoading && node.role === 'assistant' && node.content.trim() === '') return;
    const bubble = document.getElementById(`message-bubble-${node.node_id}`);
    setEditingBubbleWidth(bubble ? Math.ceil(bubble.getBoundingClientRect().width) : null);
    setEditingNodeId(node.node_id);
    setEditingDraft(node.content);
  };

  const cancelEditingNode = () => {
    setEditingNodeId(null);
    setEditingDraft('');
    setEditingBubbleWidth(null);
    setEditingActionsWidth(null);
  };

  const saveEditingNode = () => {
    if (!editingNodeId) return;
    editNodeContent(editingNodeId, editingDraft);
    cancelEditingNode();
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
    const contextChanged = previousBasePathRef.current !== context?.base_path;
    previousBasePathRef.current = context?.base_path ?? null;
    const container = messagesContainerRef.current;
    const isUserNearLatest = container
      ? isNearBottom(
          {
            scrollTop: container.scrollTop,
            scrollHeight: container.scrollHeight,
            clientHeight: container.clientHeight,
          },
          DEFAULT_SCROLL_FOLLOW_THRESHOLD_PX
        )
      : true;
    shouldAutoFollowRef.current = isUserNearLatest;

    const shouldFollow = shouldAutoScrollToLatest({
      isUserNearBottom: shouldAutoFollowRef.current,
      contextChanged,
      forceFollow: forceScrollToLatestRef.current,
    });

    if (!shouldFollow) return;

    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
    shouldAutoFollowRef.current = true;
    forceScrollToLatestRef.current = false;
  }, [nodes, context?.base_path]);

  useEffect(() => {
    if (!editingNodeId) return;
    if (!nodes[editingNodeId]) {
      cancelEditingNode();
    }
  }, [editingNodeId, nodes]);

  useEffect(() => {
    const textarea = editingTextareaRef.current;
    if (!textarea || !editingNodeId) return;
    textarea.style.height = '0px';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [editingDraft, editingNodeId]);

  useEffect(() => {
    const actions = editingActionsRef.current;
    if (!actions || !editingNodeId) return;
    const naturalWidth = actions.getBoundingClientRect().width;
    setEditingActionsWidth(Math.ceil(naturalWidth));
  }, [editingNodeId, editingDraft]);

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
      logBranchPlanPhase(pendingBranchSuggestion.feedbackContext.projectId, pendingBranchSuggestion, 'expired');
      if (pendingBranchSuggestion.assetAction && pendingBranchSuggestion.assetAction !== 'none' && pendingBranchSuggestion.assetSuggestionId && pendingBranchSuggestion.assetShownAt) {
        logSuggestionEvent(
          pendingBranchSuggestion.assetAction,
          'expired',
          pendingBranchSuggestion.assetSuggestionId,
          pendingBranchSuggestion.assetShownAt,
          pendingBranchSuggestion.feedbackContext,
          {
            targetNodeId: pendingBranchSuggestion.nodeIdsToMove[1] || null,
            basePath: pendingBranchSuggestion.originBasePath,
            originKind: 'branch_extract',
            suggestionPayload: {
              reason: pendingBranchSuggestion.assetReason || '',
              sourceNodeIds: pendingBranchSuggestion.sourceNodeIds || [],
            },
          }
        );
      }
      setPendingBranchSuggestion(null);
    }
  }, [context?.base_path, pendingBranchSuggestion]);

  useEffect(() => {
    if (!pendingStructureSuggestion) return;
    if (!context) return;
    if (context.base_path !== pendingStructureSuggestion.originBasePath) {
      if (pendingStructureSuggestion.primaryAction === 'return_parent' && pendingStructureSuggestion.returnSuggestionId && pendingStructureSuggestion.returnShownAt) {
        logSuggestionEvent(
          'return_parent',
          'expired',
          pendingStructureSuggestion.returnSuggestionId,
          pendingStructureSuggestion.returnShownAt,
          pendingStructureSuggestion.feedbackContext,
          {
            targetNodeId: pendingStructureSuggestion.targetNodeId,
            basePath: pendingStructureSuggestion.originBasePath,
            suggestionPayload: {
              reason: pendingStructureSuggestion.reason,
              sourceNodeIds: pendingStructureSuggestion.sourceNodeIds,
            },
          }
        );
      }
      if (pendingStructureSuggestion.assetAction !== 'none' && pendingStructureSuggestion.extractSuggestionId && pendingStructureSuggestion.extractShownAt) {
        logSuggestionEvent(
          pendingStructureSuggestion.assetAction,
          'expired',
          pendingStructureSuggestion.extractSuggestionId,
          pendingStructureSuggestion.extractShownAt,
          pendingStructureSuggestion.feedbackContext,
          {
            targetNodeId: pendingStructureSuggestion.targetNodeId,
            basePath: pendingStructureSuggestion.originBasePath,
            originKind: pendingStructureSuggestion.extractOriginKind || 'structure',
            suggestionPayload: {
              reason: pendingStructureSuggestion.assetReason,
              sourceNodeIds: pendingStructureSuggestion.sourceNodeIds,
            },
          }
        );
      }
      setPendingStructureSuggestion(null);
    }
  }, [context?.base_path, pendingStructureSuggestion]);

  useEffect(() => {
    setActiveInlineSuggestionIndex(0);
  }, [pendingBranchSuggestion, pendingStructureSuggestion]);

  useEffect(() => {
    if (!branchSuggestionNotice) return;
    const timer = window.setTimeout(() => setBranchSuggestionNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [branchSuggestionNotice]);

  useEffect(() => {
    if (!viewingPatternId) return;
    const pattern = patterns[viewingPatternId];
    if (!pattern) return;
    setEditName(pattern.name);
    setEditInstruction(pattern.instruction);
    setEditExample(pattern.example);
  }, [viewingPatternId, patterns]);

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

  useEffect(() => {
    if (!pendingBranchSuggestion || typeof IntersectionObserver === 'undefined') return;
    const card = document.getElementById(`context-plan-branch-suggestion-${pendingBranchSuggestion.suggestionId}`);
    if (!card) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) {
        logBranchPlanPhase(pendingBranchSuggestion.feedbackContext.projectId, pendingBranchSuggestion, 'shown');
        observer.disconnect();
      }
    }, { threshold: 0.5 });
    observer.observe(card);
    return () => observer.disconnect();
  }, [pendingBranchSuggestion, activeInlineSuggestionIndex, visibleNodes.length, context?.base_path]);

  const contextGraph = useMemo(
    () => project ? buildContextGraph(project.project_id, nodes, branches) : null,
    [project?.project_id, nodes, branches]
  );
  const compiledTurnContext = context && contextGraph
    ? compileTurnContext({ graph: contextGraph, context, visibleNodeIds: visibleNodes.map((node) => node.node_id) })
    : { nodes: [] as Node[], sources: {}, excludedNodeIds: [] as string[] };
  const allEffectiveNodes = compiledTurnContext.nodes;
  const contextReturnProposals = context && contextGraph && project && input.trim().length >= 8
    ? proposeContextReturns({
        graph: contextGraph,
        context,
        query: input,
        activeNodeIds: allEffectiveNodes.map((node) => node.node_id),
        choices: typeof window === 'undefined' ? [] : readContextChoices(window.localStorage),
        planEdits: typeof window === 'undefined' ? [] : readContextPlanEdits(window.localStorage, getActiveUserId() || 'local-anonymous'),
      }).filter((proposal) => !dismissedContextBranchIds.includes(proposal.branchId))
    : [];
  const globalPatternList = Object.values(patterns).sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
  const totalPatternPages = Math.max(1, Math.ceil(globalPatternList.length / PATTERN_PAGE_SIZE));
  const visiblePatternList = globalPatternList.slice(
    patternPage * PATTERN_PAGE_SIZE,
    patternPage * PATTERN_PAGE_SIZE + PATTERN_PAGE_SIZE
  );
  const enabledPatternMap = context?.enabled_patterns_by_type || {};
  const patternAppendix = buildPatternAppendix(enabledPatternMap, patterns);
  const selectedNodeIdSet = new Set(selectedNodeIds);

  const buildSuggestionFeedbackContext = (userNode?: Node | null, assistantNode?: Node | null): SuggestionFeedbackContext => {
    const visibleContext = buildQAPairsFromOrderedNodes(visibleNodes)
      .slice(-MAX_VISIBLE_CONTEXT_PAIRS)
      .map(clipContextPair);
    const historyPairs = visibleContext.slice(-3);
    const currentTLDR = !isMainline && currentBranch
      ? currentBranch.intent_summary || currentBranch.parent_context_tldr || summarizeRecent(visibleNodes.map((n) => n.content), 160)
      : summarizeRecent(visibleNodes.map((n) => n.content), 160);

    return {
      projectId: project.project_id,
      currentTLDR,
      visibleContext,
      historyLast3QA: historyPairs,
      currentNode: buildQAPair(userNode, assistantNode),
    };
  };

  const logSuggestionEvent = (
    kind: StructureSuggestionKind,
    decision: 'shown' | 'accepted' | 'rejected' | 'ignored' | 'expired',
    suggestionId: string,
    shownAt: string,
    feedbackContext: SuggestionFeedbackContext,
    options?: {
      targetNodeId?: string | null;
      basePath?: string | null;
      originKind?: 'structure' | 'branch_extract';
      suggestionPayload?: Record<string, unknown>;
      decidedAt?: string | null;
    }
  ) => {
    logStructureSuggestionFeedbackEvent({
      suggestion_id: suggestionId,
      project_id: feedbackContext.projectId,
      base_path: options?.basePath ?? context?.base_path ?? null,
      target_node_id: options?.targetNodeId ?? null,
      suggestion_kind: kind,
      origin_kind: options?.originKind ?? 'structure',
      decision,
      current_tldr: feedbackContext.currentTLDR,
      visible_context: feedbackContext.visibleContext,
      history_last_3_qa: feedbackContext.historyLast3QA,
      current_node: feedbackContext.currentNode,
      suggestion_payload: options?.suggestionPayload || {},
      shown_at: shownAt,
      decided_at: decision === 'shown' ? null : (options?.decidedAt ?? new Date().toISOString()),
    });
  };

  const clearBranchExtractSuggestion = (
    decision: 'accepted' | 'rejected' | 'ignored' | 'expired'
  ) => {
    setPendingBranchSuggestion((current) => {
      if (!current || !current.assetAction || current.assetAction === 'none' || !current.assetSuggestionId || !current.assetShownAt) {
        return current;
      }

      logSuggestionEvent(
        current.assetAction,
        decision,
        current.assetSuggestionId,
        current.assetShownAt,
        current.feedbackContext,
        {
          targetNodeId: current.nodeIdsToMove[1] || null,
          basePath: current.originBasePath,
          originKind: 'branch_extract',
          suggestionPayload: {
            reason: current.assetReason || '',
            sourceNodeIds: current.sourceNodeIds || [],
          },
        }
      );

      return {
        ...current,
        assetAction: 'none',
        assetReason: '',
        assetSuggestionId: undefined,
        assetShownAt: undefined,
      };
    });
  };

  useEffect(() => {
    setPatternPage((prev) => Math.min(prev, Math.max(0, totalPatternPages - 1)));
  }, [totalPatternPages]);

  const openPatternPanel = (patternId: string) => {
    setViewingPatternId(patternId);
    setIsPatternLibraryOpen(true);
  };

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
      logBranchPlanPhase(pendingBranchSuggestion.feedbackContext.projectId, pendingBranchSuggestion, 'ignored');
      const movedUser = nodes[pendingBranchSuggestion.nodeIdsToMove[0]];
      const movedAssistant = nodes[pendingBranchSuggestion.nodeIdsToMove[1]];
      const feedbackContext = buildSuggestionFeedbackContext(movedUser, movedAssistant);

      const ignoreLevel = getCurrentLevel(isMainline, currentBranch, branches);
      appendBranchFeedbackSample({
        sample_id: pendingBranchSuggestion.suggestionId,
        current_tldr: feedbackContext.currentTLDR,
        visible_context: feedbackContext.visibleContext,
        history_last_3_qa: feedbackContext.historyLast3QA,
        current_node: feedbackContext.currentNode,
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
      if (pendingBranchSuggestion.assetAction && pendingBranchSuggestion.assetAction !== 'none' && pendingBranchSuggestion.assetSuggestionId && pendingBranchSuggestion.assetShownAt) {
        logSuggestionEvent(
          pendingBranchSuggestion.assetAction,
          'ignored',
          pendingBranchSuggestion.assetSuggestionId,
          pendingBranchSuggestion.assetShownAt,
          pendingBranchSuggestion.feedbackContext,
          {
            targetNodeId: pendingBranchSuggestion.nodeIdsToMove[1] || null,
            basePath: pendingBranchSuggestion.originBasePath,
            originKind: 'branch_extract',
            suggestionPayload: {
              reason: pendingBranchSuggestion.assetReason || '',
              sourceNodeIds: pendingBranchSuggestion.sourceNodeIds || [],
            },
          }
        );
      }
      setPendingBranchSuggestion(null);
    }

    if (pendingStructureSuggestion) {
      if (pendingStructureSuggestion.primaryAction === 'return_parent' && pendingStructureSuggestion.returnSuggestionId && pendingStructureSuggestion.returnShownAt) {
        logSuggestionEvent(
          'return_parent',
          'ignored',
          pendingStructureSuggestion.returnSuggestionId,
          pendingStructureSuggestion.returnShownAt,
          pendingStructureSuggestion.feedbackContext,
          {
            targetNodeId: pendingStructureSuggestion.targetNodeId,
            basePath: pendingStructureSuggestion.originBasePath,
            suggestionPayload: {
              reason: pendingStructureSuggestion.reason,
              sourceNodeIds: pendingStructureSuggestion.sourceNodeIds,
            },
          }
        );
      }
      if (pendingStructureSuggestion.assetAction !== 'none' && pendingStructureSuggestion.extractSuggestionId && pendingStructureSuggestion.extractShownAt) {
        logSuggestionEvent(
          pendingStructureSuggestion.assetAction,
          'ignored',
          pendingStructureSuggestion.extractSuggestionId,
          pendingStructureSuggestion.extractShownAt,
          pendingStructureSuggestion.feedbackContext,
          {
            targetNodeId: pendingStructureSuggestion.targetNodeId,
            basePath: pendingStructureSuggestion.originBasePath,
            originKind: pendingStructureSuggestion.extractOriginKind || 'structure',
            suggestionPayload: {
              reason: pendingStructureSuggestion.assetReason,
              sourceNodeIds: pendingStructureSuggestion.sourceNodeIds,
            },
          }
        );
      }
      setPendingStructureSuggestion(null);
    }

    const userMsg = input.trim();
    setInput('');
    setIsLoading(true);
    shouldAutoFollowRef.current = true;
    forceScrollToLatestRef.current = true;
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

    // Legacy branch-only agent kept here for quick rollback if needed.
    // const branchDetectionPromise = shouldDetectBranch
    //   ? detectBranchSuggestion(liveVisibleNodes, userMsg, {
    //       currentMode: liveIsMainline ? 'mainline' : 'branch',
    //       branchDepth: liveBranchDepth,
    //       currentBranchIntent,
    //       parentContextTLDR,
    //       mainlineTLDR,
    //       totalBranchCount,
    //       activeBranchCount,
    //       recentBranchIntents,
    //     })
    //   : Promise.resolve(null);

    const structureDetectionPromise =
      shouldDetectBranch && parentId
        ? detectStructureSuggestion(selectStructureReadSet(allEffectiveNodes, liveContext?.included_nodes), userMsg, {
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
    if (liveContext) {
      recordContextTurnPlan({
        projectId: project.project_id,
        turnNodeId: userNodeId,
        query: userMsg,
        context: liveContext,
        selectedNodeIds: allEffectiveNodes.map((node) => node.node_id),
      });
    }
    const userTimestamp = useAppStore.getState().nodes[userNodeId]?.timestamp ?? new Date().toISOString();
    const assistantTimestamp = createChildTimestampAfter(userTimestamp, new Date().toISOString());
    const assistantNodeId = addNode(project.project_id, userNodeId, 'assistant', '', branchId, assistantTimestamp);
    const persistedUserNode = useAppStore.getState().nodes[userNodeId];
    if (persistedUserNode) {
      void logChatNode(persistedUserNode, { projectTitle: project.title });
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
      const effectiveNodeIds = new Set(allEffectiveNodes.map((n) => n.node_id));
      const visibleBranchSummaries = isMainline
        ? Object.values(branches)
            .filter((b) => b.branch_summary && effectiveNodeIds.has(b.anchor_node_id))
            .map((b) => b.branch_summary!)
        : [];

      const systemPrompt = buildConversationSystemPrompt({
        isMainline,
        branchAnchorNodeId: currentBranch?.anchor_node_id || null,
        mainlineSummary: currentBranch?.mainline_summary || '',
        branchSummaries: visibleBranchSummaries,
      });
      
      const responseText = await generateResponseStream(
        systemPrompt,
        allEffectiveNodes,
        userMsg,
        patternAppendix,
        (delta) => updateNodeContent(assistantNodeId, delta, 'append'),
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
        void logChatNode(persistedAssistantNode, { projectTitle: project.title });
      }
      const structureDecision = await structureDetectionPromise;
      logBranchDebug('structure-decision', {
        primaryAction: structureDecision?.primaryAction ?? 'continue',
        assetAction: structureDecision?.assetAction ?? 'none',
        confidence: structureDecision?.confidence ?? 0,
        reason: structureDecision?.reason ?? '',
        assetReason: structureDecision?.assetReason ?? '',
        showSuggestion: structureDecision?.showSuggestion ?? false,
        basePath: liveContext?.base_path ?? 'unknown',
        parentId,
      });
      if (structureDecision?.showSuggestion && structureDecision.primaryAction === 'branch' && parentId) {
        const state = useAppStore.getState();
        const activeContextId = state.projects[project.project_id]?.active_context_id;
        const activeContext = activeContextId ? state.contexts[activeContextId] : null;
        if (activeContext?.base_path === (liveContext?.base_path ?? 'mainline')) {
          const feedbackContext = buildSuggestionFeedbackContext(
            state.nodes[userNodeId],
            state.nodes[assistantNodeId]
          );
          const branchExtractShownAt =
            structureDecision.assetAction && structureDecision.assetAction !== 'none'
              ? new Date().toISOString()
              : undefined;
          const branchExtractSuggestionId =
            structureDecision.assetAction && structureDecision.assetAction !== 'none'
              ? createSuggestionId()
              : undefined;
          if (structureDecision.assetAction && structureDecision.assetAction !== 'none' && branchExtractSuggestionId && branchExtractShownAt) {
            logSuggestionEvent(
              structureDecision.assetAction,
              'shown',
              branchExtractSuggestionId,
              branchExtractShownAt,
              feedbackContext,
              {
                targetNodeId: assistantNodeId,
                basePath: activeContext.base_path,
                originKind: 'branch_extract',
                suggestionPayload: {
                  reason: structureDecision.assetReason || '',
                  sourceNodeIds: liveVisibleNodes.map((node) => node.node_id).concat([userNodeId, assistantNodeId]),
                },
                decidedAt: null,
              }
            );
          }
          logBranchDebug('suggestion-pre-snapshot', buildSuggestionSnapshot());
          const branchSuggestion: PendingBranchSuggestion = {
            suggestionId: createSuggestionId(),
            anchorNodeId: parentId,
            reason: structureDecision.reason || 'This looks like a temporary or off-topic subtask.',
            nodeIdsToMove: [userNodeId, assistantNodeId],
            originBasePath: activeContext.base_path,
            feedbackContext,
            assetAction: structureDecision.assetAction,
            assetReason: structureDecision.assetReason,
            sourceNodeIds: liveVisibleNodes.map((node) => node.node_id).concat([userNodeId, assistantNodeId]),
            assetSuggestionId: branchExtractSuggestionId,
            assetShownAt: branchExtractShownAt,
          };
          setPendingBranchSuggestion(branchSuggestion);
          logBranchPlanPhase(branchSuggestion.feedbackContext.projectId, branchSuggestion, 'created');
          logBranchDebug('suggestion-created', {
            anchorNodeId: parentId,
            originBasePath: activeContext.base_path,
            nodeIdsToMove: [userNodeId, assistantNodeId],
            reason: structureDecision.reason || '',
          });
          logBranchDebug('suggestion-post-snapshot', buildSuggestionSnapshot());
        }
      }

      if (
        structureDecision?.showSuggestion &&
        parentId &&
        liveContext &&
        structureDecision.primaryAction !== 'branch' &&
        (structureDecision.primaryAction === 'return_parent' || structureDecision.assetAction !== 'none')
      ) {
        const state = useAppStore.getState();
        const activeContextId = state.projects[project.project_id]?.active_context_id;
        const activeContext = activeContextId ? state.contexts[activeContextId] : null;
        if (activeContext?.base_path === liveContext.base_path) {
          const feedbackContext = buildSuggestionFeedbackContext(
            state.nodes[userNodeId],
            state.nodes[assistantNodeId]
          );
          const shownAt = new Date().toISOString();
          const returnSuggestionId =
            structureDecision.primaryAction === 'return_parent' ? createSuggestionId() : undefined;
          const extractSuggestionId =
            structureDecision.assetAction !== 'none' ? createSuggestionId() : undefined;

          if (returnSuggestionId) {
            logSuggestionEvent(
              'return_parent',
              'shown',
              returnSuggestionId,
              shownAt,
              feedbackContext,
              {
                targetNodeId: assistantNodeId,
                basePath: activeContext.base_path,
                suggestionPayload: {
                  reason: structureDecision.reason,
                  sourceNodeIds: liveVisibleNodes.map((node) => node.node_id).concat([userNodeId, assistantNodeId]),
                },
                decidedAt: null,
              }
            );
          }
          if (extractSuggestionId) {
            logSuggestionEvent(
              structureDecision.assetAction,
              'shown',
              extractSuggestionId,
              shownAt,
              feedbackContext,
              {
                targetNodeId: assistantNodeId,
                basePath: activeContext.base_path,
                suggestionPayload: {
                  reason: structureDecision.assetReason,
                  sourceNodeIds: liveVisibleNodes.map((node) => node.node_id).concat([userNodeId, assistantNodeId]),
                },
                decidedAt: null,
              }
            );
          }
          setPendingStructureSuggestion({
            targetNodeId: assistantNodeId,
            originBasePath: activeContext.base_path,
            primaryAction: structureDecision.primaryAction,
            assetAction: structureDecision.assetAction,
            reason: structureDecision.reason,
            assetReason: structureDecision.assetReason,
            sourceNodeIds: liveVisibleNodes.map((node) => node.node_id).concat([userNodeId, assistantNodeId]),
            feedbackContext,
            returnSuggestionId,
            returnShownAt: returnSuggestionId ? shownAt : undefined,
            extractSuggestionId,
            extractShownAt: extractSuggestionId ? shownAt : undefined,
            extractOriginKind: extractSuggestionId ? 'structure' : undefined,
          });
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
    const feedbackContext = buildSuggestionFeedbackContext(
      currentPair.user ? anchorNode : null,
      currentPair.assistant ? (anchorNode?.role === 'assistant' ? anchorNode : Object.values(nodes).find((n) => n.parent_id === anchorNode?.node_id && n.role === 'assistant') || null) : null
    );

    const manualLevel = getCurrentLevel(isMainline, currentBranch, branches);
    const manualSample = {
      current_tldr: feedbackContext.currentTLDR,
      visible_context: feedbackContext.visibleContext,
      history_last_3_qa: feedbackContext.historyLast3QA,
      current_node: feedbackContext.currentNode,
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
      logBranchPlanPhase(pendingBranchSuggestion.feedbackContext.projectId, pendingBranchSuggestion, 'expired');
      if (pendingBranchSuggestion.assetAction && pendingBranchSuggestion.assetAction !== 'none' && pendingBranchSuggestion.assetSuggestionId && pendingBranchSuggestion.assetShownAt) {
        logSuggestionEvent(
          pendingBranchSuggestion.assetAction,
          'expired',
          pendingBranchSuggestion.assetSuggestionId,
          pendingBranchSuggestion.assetShownAt,
          pendingBranchSuggestion.feedbackContext,
          {
            targetNodeId: assistantNodeId,
            basePath: pendingBranchSuggestion.originBasePath,
            originKind: 'branch_extract',
            suggestionPayload: {
              reason: pendingBranchSuggestion.assetReason || '',
              sourceNodeIds: pendingBranchSuggestion.sourceNodeIds || [],
            },
          }
        );
      }
      setPendingBranchSuggestion(null);
      setBranchSuggestionNotice('Branch suggestion expired. Please regenerate.');
      return;
    }

    const movedUser = nodes[pendingBranchSuggestion.nodeIdsToMove[0]];
    const movedAssistant = nodes[pendingBranchSuggestion.nodeIdsToMove[1]];
    const feedbackContext = buildSuggestionFeedbackContext(movedUser, movedAssistant);

    const acceptLevel = getCurrentLevel(isMainline, currentBranch, branches);
    const acceptSample = {
      sample_id: pendingBranchSuggestion.suggestionId,
      current_tldr: feedbackContext.currentTLDR,
      visible_context: feedbackContext.visibleContext,
      history_last_3_qa: feedbackContext.historyLast3QA,
      current_node: feedbackContext.currentNode,
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
      logBranchPlanPhase(pendingBranchSuggestion.feedbackContext.projectId, pendingBranchSuggestion, 'expired');
      console.warn('[branch-accept] no nodes moved for suggested branch', {
        projectId: project.project_id,
        anchorNodeId: pendingBranchSuggestion.anchorNodeId,
      });
      if (pendingBranchSuggestion.assetAction && pendingBranchSuggestion.assetAction !== 'none' && pendingBranchSuggestion.assetSuggestionId && pendingBranchSuggestion.assetShownAt) {
        logSuggestionEvent(
          pendingBranchSuggestion.assetAction,
          'expired',
          pendingBranchSuggestion.assetSuggestionId,
          pendingBranchSuggestion.assetShownAt,
          pendingBranchSuggestion.feedbackContext,
          {
            targetNodeId: assistantNodeId,
            basePath: pendingBranchSuggestion.originBasePath,
            originKind: 'branch_extract',
            suggestionPayload: {
              reason: pendingBranchSuggestion.assetReason || '',
              sourceNodeIds: pendingBranchSuggestion.sourceNodeIds || [],
            },
          }
        );
      }
      setBranchSuggestionNotice('Branch suggestion is stale. Please regenerate.');
    } else {
      logBranchPlanPhase(pendingBranchSuggestion.feedbackContext.projectId, pendingBranchSuggestion, 'accepted');
      setPendingBranchFeedback(createdBranchId, acceptSample);
      if (pendingBranchSuggestion.assetAction && pendingBranchSuggestion.assetAction !== 'none') {
        setPendingStructureSuggestion({
          targetNodeId: assistantNodeId,
          originBasePath: createdBranchId,
          primaryAction: 'continue',
          assetAction: pendingBranchSuggestion.assetAction,
          reason: '',
          assetReason: pendingBranchSuggestion.assetReason || '',
          sourceNodeIds:
            pendingBranchSuggestion.sourceNodeIds ||
            [userNodeId, assistantNodeId],
          feedbackContext: pendingBranchSuggestion.feedbackContext,
          extractSuggestionId: pendingBranchSuggestion.assetSuggestionId,
          extractShownAt: pendingBranchSuggestion.assetShownAt,
          extractOriginKind: 'branch_extract',
        });
      }
    }
    setPendingBranchSuggestion(null);
  };

  const handleRejectBranchSuggestion = () => {
    if (!pendingBranchSuggestion) return;
    logBranchPlanPhase(pendingBranchSuggestion.feedbackContext.projectId, pendingBranchSuggestion, 'rejected');
    const movedUser = nodes[pendingBranchSuggestion.nodeIdsToMove[0]];
    const movedAssistant = nodes[pendingBranchSuggestion.nodeIdsToMove[1]];
    const feedbackContext = buildSuggestionFeedbackContext(movedUser, movedAssistant);

    const rejectLevel = getCurrentLevel(isMainline, currentBranch, branches);
    appendBranchFeedbackSample({
      sample_id: pendingBranchSuggestion.suggestionId,
      current_tldr: feedbackContext.currentTLDR,
      visible_context: feedbackContext.visibleContext,
      history_last_3_qa: feedbackContext.historyLast3QA,
      current_node: feedbackContext.currentNode,
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
    if (pendingBranchSuggestion.assetAction && pendingBranchSuggestion.assetAction !== 'none' && pendingBranchSuggestion.assetSuggestionId && pendingBranchSuggestion.assetShownAt) {
      logSuggestionEvent(
        pendingBranchSuggestion.assetAction,
        'rejected',
        pendingBranchSuggestion.assetSuggestionId,
        pendingBranchSuggestion.assetShownAt,
        pendingBranchSuggestion.feedbackContext,
        {
          targetNodeId: pendingBranchSuggestion.nodeIdsToMove[1] || null,
          basePath: pendingBranchSuggestion.originBasePath,
          originKind: 'branch_extract',
          suggestionPayload: {
            reason: pendingBranchSuggestion.assetReason || '',
            sourceNodeIds: pendingBranchSuggestion.sourceNodeIds || [],
          },
        }
      );
    }
    setPendingBranchSuggestion(null);
  };

  const handleDismissStructureSuggestion = () => {
    if (structureActionInFlight) return;
    if (pendingStructureSuggestion?.primaryAction === 'return_parent' && pendingStructureSuggestion.returnSuggestionId && pendingStructureSuggestion.returnShownAt) {
      logSuggestionEvent(
        'return_parent',
        'rejected',
        pendingStructureSuggestion.returnSuggestionId,
        pendingStructureSuggestion.returnShownAt,
        pendingStructureSuggestion.feedbackContext,
        {
          targetNodeId: pendingStructureSuggestion.targetNodeId,
          basePath: pendingStructureSuggestion.originBasePath,
          suggestionPayload: {
            reason: pendingStructureSuggestion.reason,
            sourceNodeIds: pendingStructureSuggestion.sourceNodeIds,
          },
        }
      );
    }
    if (pendingStructureSuggestion?.assetAction !== 'none' && pendingStructureSuggestion.extractSuggestionId && pendingStructureSuggestion.extractShownAt) {
      logSuggestionEvent(
        pendingStructureSuggestion.assetAction,
        'rejected',
        pendingStructureSuggestion.extractSuggestionId,
        pendingStructureSuggestion.extractShownAt,
        pendingStructureSuggestion.feedbackContext,
        {
          targetNodeId: pendingStructureSuggestion.targetNodeId,
          basePath: pendingStructureSuggestion.originBasePath,
          originKind: pendingStructureSuggestion.extractOriginKind || 'structure',
          suggestionPayload: {
            reason: pendingStructureSuggestion.assetReason,
            sourceNodeIds: pendingStructureSuggestion.sourceNodeIds,
          },
        }
      );
    }
    setPendingStructureSuggestion(null);
  };

  const handleDismissBranchExtractSuggestion = () => {
    if (structureActionInFlight) return;
    clearBranchExtractSuggestion('rejected');
  };

  const extractSuggestedPattern = async (
    assetAction: 'extract_reasoning' | 'extract_task_sop',
    sourceNodeIds: string[],
    preserveReturnAction = false
  ): Promise<boolean> => {
    setStructureActionInFlight('extract');
    const selectedNodes = sourceNodeIds
      .map((nodeId) => nodes[nodeId])
      .filter((node): node is Node => !!node)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    if (selectedNodes.length === 0) {
      setPendingStructureSuggestion(null);
      setPendingBranchSuggestion(null);
      setStructureActionInFlight(null);
      return false;
    }

    try {
      const patternType: PatternType = assetAction === 'extract_reasoning' ? 'reasoning' : 'task_sop';
      const extracted = await extractPatternByType(selectedNodes, patternType);
      createPattern({
        type: patternType,
        name: extracted.name,
        requires_human_review: extracted.requires_human_review,
        instruction: extracted.instruction,
        example: extracted.example,
        fromNodeId: selectedNodes[0].node_id,
        toNodeId: selectedNodes[selectedNodes.length - 1].node_id,
        sourceProjectId: project.project_id,
      });
      setInlineNotice({
        id: `structure-pattern-${Date.now()}`,
        title: extracted.requires_human_review ? 'Pattern extracted for review' : 'Pattern extracted',
        message: extracted.requires_human_review
          ? 'The suggested pattern was saved as a draft and still needs review before enablement.'
          : 'The suggested pattern was saved and is ready in the pattern library.',
      });
      setPendingBranchSuggestion((current) =>
        current
          ? {
              ...current,
              assetAction: 'none',
              assetReason: '',
            }
          : current
      );
      setPendingStructureSuggestion((current) => {
        if (!current) return current;
        if (preserveReturnAction && current.primaryAction === 'return_parent') {
          return {
            ...current,
            assetAction: 'none',
            assetReason: '',
          };
        }
        return null;
      });
      return true;
    } catch (error) {
      console.error(error);
      setInlineNotice({
        id: `structure-pattern-error-${Date.now()}`,
        title: 'Pattern extraction failed',
        message: 'The suggested pattern could not be extracted from this thread.',
      });
      setPendingStructureSuggestion(null);
      setPendingBranchSuggestion(null);
      return false;
    } finally {
      setStructureActionInFlight(null);
    }
  };

  const triggerBranchSummaryGeneration = (branchId: string) => {
    const branch = branches[branchId];
    if (!branch || branch.branch_summary) return;
    const branchNodes = Object.values(nodes)
      .filter((n) => n.branch_id === branchId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    if (branchNodes.length === 0) return;
    generateBranchSummary(branchNodes).then((summary) => {
      if (summary) updateBranchCompletionSummary(branchId, summary);
    });
  };

  const handleAcceptReturnSuggestion = () => {
    if (
      structureActionInFlight ||
      !pendingStructureSuggestion ||
      pendingStructureSuggestion.primaryAction !== 'return_parent'
    ) {
      return;
    }

    setStructureActionInFlight('return');
    const returningBranchId = context?.base_path !== 'mainline' ? context?.base_path : null;
    try {
      returnToParentBranch(project.project_id);
      if (returningBranchId) triggerBranchSummaryGeneration(returningBranchId);
      if (pendingStructureSuggestion.returnSuggestionId && pendingStructureSuggestion.returnShownAt) {
        logSuggestionEvent(
          'return_parent',
          'accepted',
          pendingStructureSuggestion.returnSuggestionId,
          pendingStructureSuggestion.returnShownAt,
          pendingStructureSuggestion.feedbackContext,
          {
            targetNodeId: pendingStructureSuggestion.targetNodeId,
            basePath: pendingStructureSuggestion.originBasePath,
            suggestionPayload: {
              reason: pendingStructureSuggestion.reason,
              sourceNodeIds: pendingStructureSuggestion.sourceNodeIds,
            },
          }
        );
      }
      setPendingStructureSuggestion((current) =>
        current
          ? {
              ...current,
              primaryAction: 'continue',
              reason: '',
              returnSuggestionId: undefined,
              returnShownAt: undefined,
            }
          : current
      );
    } finally {
      setStructureActionInFlight(null);
    }
  };

  const handleAcceptExtractSuggestion = async () => {
    if (
      structureActionInFlight ||
      !pendingStructureSuggestion ||
      pendingStructureSuggestion.assetAction === 'none'
    ) {
      return;
    }

    const extracted = await extractSuggestedPattern(
      pendingStructureSuggestion.assetAction,
      pendingStructureSuggestion.sourceNodeIds,
      pendingStructureSuggestion.primaryAction === 'return_parent'
    );
    if (extracted && pendingStructureSuggestion.extractSuggestionId && pendingStructureSuggestion.extractShownAt) {
      logSuggestionEvent(
        pendingStructureSuggestion.assetAction,
        'accepted',
        pendingStructureSuggestion.extractSuggestionId,
        pendingStructureSuggestion.extractShownAt,
        pendingStructureSuggestion.feedbackContext,
        {
          targetNodeId: pendingStructureSuggestion.targetNodeId,
          basePath: pendingStructureSuggestion.originBasePath,
          originKind: pendingStructureSuggestion.extractOriginKind || 'structure',
          suggestionPayload: {
            reason: pendingStructureSuggestion.assetReason,
            sourceNodeIds: pendingStructureSuggestion.sourceNodeIds,
          },
        }
      );
    }
  };

  const handleAcceptBranchExtractSuggestion = async () => {
    if (
      structureActionInFlight ||
      !pendingBranchSuggestion ||
      !pendingBranchSuggestion.sourceNodeIds ||
      pendingBranchSuggestion.assetAction === 'none' ||
      !pendingBranchSuggestion.assetAction
    ) {
      return;
    }

    const extracted = await extractSuggestedPattern(pendingBranchSuggestion.assetAction, pendingBranchSuggestion.sourceNodeIds);
    if (extracted && pendingBranchSuggestion.assetSuggestionId && pendingBranchSuggestion.assetShownAt) {
      logSuggestionEvent(
        pendingBranchSuggestion.assetAction,
        'accepted',
        pendingBranchSuggestion.assetSuggestionId,
        pendingBranchSuggestion.assetShownAt,
        pendingBranchSuggestion.feedbackContext,
        {
          targetNodeId: pendingBranchSuggestion.nodeIdsToMove[1] || null,
          basePath: pendingBranchSuggestion.originBasePath,
          originKind: 'branch_extract',
          suggestionPayload: {
            reason: pendingBranchSuggestion.assetReason || '',
            sourceNodeIds: pendingBranchSuggestion.sourceNodeIds || [],
          },
        }
      );
    }
  };

  const goToPreviousInlineSuggestion = (itemCount: number) => {
    setActiveInlineSuggestionIndex((current) => {
      if (itemCount <= 1) return 0;
      return current <= 0 ? itemCount - 1 : current - 1;
    });
  };

  const goToNextInlineSuggestion = (itemCount: number) => {
    setActiveInlineSuggestionIndex((current) => {
      if (itemCount <= 1) return 0;
      return current >= itemCount - 1 ? 0 : current + 1;
    });
  };

  const handleTogglePatternEnabled = (pattern: Pattern) => {
    if (pattern.requires_human_review && pattern.review_status !== 'approved') {
      setInlineNotice({
        id: `pattern-review-${pattern.pattern_id}-${Date.now()}`,
        title: 'Pattern review required',
        message: 'This pattern needs human review before it can be enabled.',
      });
      return;
    }
    if (context.enabled_patterns_by_type[pattern.type] === pattern.pattern_id) {
      disablePatternForType(project.project_id, context.context_id, pattern.type);
      return;
    }
    enablePatternForType(project.project_id, context.context_id, pattern.type, pattern.pattern_id);
  };

  const handleSavePatternEdits = (approve = false) => {
    if (!viewingPatternId) return;
    updatePattern(viewingPatternId, {
      name: editName.trim() || 'Untitled Pattern',
      instruction: editInstruction.trim(),
      example: editExample.trim(),
    });
    if (approve) {
      approvePattern(viewingPatternId);
    }
  };

  const renderPatternEditor = () => {
    if (!viewingPatternId || !patterns[viewingPatternId]) return null;
    const activePattern = patterns[viewingPatternId];

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-zinc-500">Name</span>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="border border-zinc-300 rounded px-2 py-1.5"
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-zinc-500">Type</span>
            <div className="border border-zinc-200 rounded px-2 py-1.5 bg-zinc-50 text-zinc-700">
              {PATTERN_TYPE_LABEL[activePattern.type]}
            </div>
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <span className="text-zinc-500">Requires Human Review</span>
            <div className="border border-zinc-200 rounded px-2 py-1.5 bg-zinc-50 text-zinc-700">
              {activePattern.requires_human_review ? 'true' : 'false'} · {activePattern.review_status}
            </div>
          </div>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">Instruction</span>
          <textarea
            value={editInstruction}
            onChange={(e) => setEditInstruction(e.target.value)}
            rows={8}
            className="border border-zinc-300 rounded px-2 py-1.5 resize-y"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">Example</span>
          <textarea
            value={editExample}
            onChange={(e) => setEditExample(e.target.value)}
            rows={6}
            className="border border-zinc-300 rounded px-2 py-1.5 resize-y"
          />
        </label>

        <div className="flex justify-between items-center">
          <button
            onClick={() => {
              const currentIndex = globalPatternList.findIndex((pattern) => pattern.pattern_id === activePattern.pattern_id);
              deletePattern(activePattern.pattern_id);
              const nextPattern = globalPatternList.find((pattern, index) => index !== currentIndex && pattern.pattern_id !== activePattern.pattern_id);
              if (nextPattern) {
                setViewingPatternId(nextPattern.pattern_id);
              } else {
                setViewingPatternId(null);
                setIsPatternLibraryOpen(false);
              }
            }}
            className="px-3 py-1.5 text-sm rounded border border-red-300 text-red-700 hover:bg-red-50"
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => handleSavePatternEdits(false)}
              className="px-3 py-1.5 text-sm rounded border border-zinc-300 text-zinc-700 hover:bg-zinc-100"
            >
              Save
            </button>
            {activePattern.requires_human_review && activePattern.review_status !== 'approved' && (
              <button
                onClick={() => handleSavePatternEdits(true)}
                className="px-3 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1"
              >
                <Check size={14} />
                Approve & Save
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (!inlineNotice) return;
    const timeout = window.setTimeout(() => {
      setInlineNotice((current) => (current?.id === inlineNotice.id ? null : current));
    }, 3200);
    return () => window.clearTimeout(timeout);
  }, [inlineNotice]);

  if (!project || !context) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-400 bg-white">
        Select or create a project to start.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-white relative">
      {inlineNotice && (
        <div className="absolute top-4 right-20 z-20 w-[min(20rem,calc(100%-2rem))]">
          <div className="rounded-[1.15rem] border border-amber-200 bg-white/95 px-3 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.12)] backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-700">
                <TriangleAlert size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-600">Patterns</p>
                    <h3 className="mt-1 text-sm font-semibold text-zinc-900">{inlineNotice.title}</h3>
                  </div>
                  <button
                    onClick={() => setInlineNotice(null)}
                    className="rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                    aria-label="Dismiss notice"
                  >
                    <X size={14} />
                  </button>
                </div>
                <p className="mt-2 text-sm leading-5 text-zinc-700">{inlineNotice.message}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Status Bar for Branch Mode */}
      {!isMainline && currentBranch && (
        <BranchStatusBar
          anchorPreview={`${nodes[currentBranch.anchor_node_id]?.content.substring(0, 20)}...`}
          canReturnParent={!!currentBranch.parent_branch_id}
          onReturnMainline={() => {
            const branchId = currentBranch.branch_id;
            returnToMainline(project.project_id);
            triggerBranchSummaryGeneration(branchId);
          }}
          onReturnParent={currentBranch.parent_branch_id ? () => {
            const branchId = currentBranch.branch_id;
            returnToParentBranch(project.project_id);
            triggerBranchSummaryGeneration(branchId);
          } : undefined}
          onPromote={() => promoteBranch(project.project_id, currentBranch.branch_id)}
        />
      )}

      {/* Messages Area */}
      <div
        ref={messagesContainerRef}
        onScroll={(event) => {
          shouldAutoFollowRef.current = isNearBottom(
            {
              scrollTop: event.currentTarget.scrollTop,
              scrollHeight: event.currentTarget.scrollHeight,
              clientHeight: event.currentTarget.clientHeight,
            },
            DEFAULT_SCROLL_FOLLOW_THRESHOLD_PX
          );
        }}
        className="flex-1 overflow-y-auto p-6 space-y-6"
      >
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
            const edited = isNodeEdited(node);
            const isEditingNode = editingNodeId === node.node_id;
            const isExcluded = context.excluded_nodes.includes(node.node_id);
            const isSelectionActive = isNodeSelectionMode;
            const isSelectedNode = selectedNodeIdSet.has(node.node_id);
            const inlineSuggestionTargetNodeId = pendingBranchSuggestion?.nodeIdsToMove[1];
            const inlineSuggestionItems =
              node.role !== 'assistant'
                ? []
                : buildInlineSuggestions(
                    {
                      targetNodeId:
                        pendingStructureSuggestion?.targetNodeId ||
                        inlineSuggestionTargetNodeId ||
                        '',
                      branchSuggestion:
                        inlineSuggestionTargetNodeId === node.node_id && pendingBranchSuggestion
                          ? {
                              reason: pendingBranchSuggestion.reason,
                              assetAction: pendingBranchSuggestion.assetAction,
                              assetReason: pendingBranchSuggestion.assetReason,
                            }
                          : null,
                      structureSuggestion:
                        pendingStructureSuggestion?.targetNodeId === node.node_id
                          ? {
                              primaryAction: pendingStructureSuggestion.primaryAction,
                              assetAction: pendingStructureSuggestion.assetAction,
                              reason: pendingStructureSuggestion.reason,
                              assetReason: pendingStructureSuggestion.assetReason,
                            }
                          : null,
                    },
                    node.node_id
                  );
            const activeInlineItem = inlineSuggestionItems.length
              ? inlineSuggestionItems[
                  clampInlineSuggestionIndex(activeInlineSuggestionIndex, inlineSuggestionItems.length)
                ]
              : null;
            return (
              <div
                key={node.node_id}
                id={`node-${node.node_id}`}
                onMouseDown={(e) => {
                  if (!isSelectionActive) return;
                  e.preventDefault();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isSelectionActive) return;
                  e.preventDefault();
                  toggleNodeSelection(node.node_id);
                }}
                className={clsx(
                  'flex flex-col max-w-3xl mx-auto group transition-all',
                  node.role === 'user' ? "items-end" : "items-start",
                  isSelectionActive ? 'cursor-pointer' : 'cursor-default',
                  isExcluded && "opacity-40"
                )}
              >
                <div className={clsx("flex items-center gap-2 mb-1 px-1", node.role === 'user' && "flex-row-reverse")}>
                  <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    {node.role}
                  </span>
                  {isSelectionActive && (
                    <span className={clsx(
                      "text-[10px] px-1.5 py-0.5 rounded-sm font-medium",
                      isSelectedNode ? "bg-zinc-900 text-white" : nodeSelectionIntent === 'delete' ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"
                    )}>
                      {isSelectedNode ? 'Selected' : nodeSelectionIntent === 'delete' ? 'Delete mode' : 'Selection mode'}
                    </span>
                  )}
                  {isExcluded && (
                    <span className="text-[10px] bg-zinc-200 text-zinc-600 px-1.5 py-0.5 rounded-sm">
                      Excluded from Context
                    </span>
                  )}
                  {edited && (
                    <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-sm">
                      Edited
                    </span>
                  )}
                  <ConversationNodeHoverActions
                    isSelectionActive={isSelectionActive}
                    isExcluded={isExcluded}
                    canEdit={node.role !== 'system'}
                    onBranch={(e) => { e.stopPropagation(); handleReBranch(node.node_id); }}
                    onToggleContext={(e) => { e.stopPropagation(); toggleNodeInclusion(project.project_id, node.node_id); }}
                    onEdit={(e) => { e.stopPropagation(); startEditingNode(node); }}
                  />
                </div>
                <div
                  id={`message-bubble-${node.node_id}`}
                  className={clsx(
                    "px-5 py-3.5 rounded-2xl shadow-sm max-w-[85%] text-[15px] leading-relaxed border-2 transition-colors",
                    node.role === 'user'
                      ? "bg-zinc-900 text-zinc-50 rounded-tr-sm border-zinc-900"
                      : node.role === 'system'
                      ? "bg-red-50 text-red-900 border-red-100 rounded-tl-sm"
                      : "bg-white border-zinc-200 text-zinc-800 rounded-tl-sm",
                    isSelectionActive && !isSelectedNode && nodeSelectionIntent === 'delete' && "border-rose-200",
                    isSelectionActive && !isSelectedNode && nodeSelectionIntent === 'batch' && "border-sky-200",
                    isSelectedNode && nodeSelectionIntent === 'delete' && "border-rose-500 ring-2 ring-rose-200",
                    isSelectedNode && nodeSelectionIntent === 'batch' && "border-sky-500 ring-2 ring-sky-200"
                  )}
                  style={
                    isEditingNode && (editingBubbleWidth || editingActionsWidth)
                      ? {
                          width: `${Math.max(
                            editingBubbleWidth ?? 0,
                            (editingActionsWidth ?? 0) + MESSAGE_BUBBLE_HORIZONTAL_PADDING
                          )}px`,
                        }
                      : undefined
                  }
                >
                  {isEditingNode ? (
                    <div className="space-y-3">
                      <textarea
                        ref={editingTextareaRef}
                        value={editingDraft}
                        onChange={(e) => setEditingDraft(e.target.value)}
                        rows={1}
                        className="block w-full overflow-hidden border-0 bg-transparent p-0 text-[15px] leading-relaxed outline-none focus:outline-none focus:ring-0"
                        style={{
                          color: 'inherit',
                          backgroundColor: 'transparent',
                          caretColor: node.role === 'user' ? '#f8fafc' : '#18181b',
                        }}
                      />
                      <div
                        className="flex items-center justify-end gap-2 border-t pt-2"
                        style={{
                          borderColor: node.role === 'user' ? 'rgba(248,250,252,0.18)' : 'rgba(24,24,27,0.08)',
                        }}
                      >
                        <div ref={editingActionsRef} className="ml-auto inline-flex items-center gap-2">
                          <button
                            onClick={cancelEditingNode}
                            className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                            style={{
                              color: node.role === 'user' ? '#f4f4f5' : '#3f3f46',
                              backgroundColor: node.role === 'user' ? 'rgba(255,255,255,0.08)' : '#ffffff',
                              border: node.role === 'user' ? '1px solid rgba(255,255,255,0.14)' : '1px solid #d4d4d8',
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={saveEditingNode}
                            className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                            style={{
                              color: node.role === 'user' ? '#18181b' : '#ffffff',
                              backgroundColor: node.role === 'user' ? '#f4f4f5' : '#18181b',
                              border: '1px solid transparent',
                            }}
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : node.role === 'assistant' && node.content.trim() === '' ? (
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
                  {activeInlineItem && (
                    <div
                      id={activeInlineItem.kind === 'branch' && pendingBranchSuggestion
                        ? `context-plan-branch-suggestion-${pendingBranchSuggestion.suggestionId}`
                        : undefined}
                      className={clsx(
                        "mt-3 rounded-xl px-4 py-3",
                        activeInlineItem.accent === 'amber'
                          ? 'border border-amber-200 bg-amber-50'
                          : 'border border-indigo-200 bg-indigo-50'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p
                            className={clsx(
                              "text-sm font-semibold",
                              activeInlineItem.accent === 'amber' ? 'text-amber-900' : 'text-indigo-900'
                            )}
                          >
                            {activeInlineItem.title}
                          </p>
                          <p
                            className={clsx(
                              "text-xs mt-1",
                              activeInlineItem.accent === 'amber' ? 'text-amber-800' : 'text-indigo-800'
                            )}
                          >
                            {activeInlineItem.message}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={
                              activeInlineItem.kind === 'branch'
                                ? handleRejectBranchSuggestion
                                : activeInlineItem.kind === 'branch_extract'
                                  ? handleDismissBranchExtractSuggestion
                                  : handleDismissStructureSuggestion
                            }
                            disabled={structureActionInFlight !== null}
                            className="px-3 py-1.5 rounded-md text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:bg-zinc-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Reject
                          </button>
                          <button
                            onClick={
                              activeInlineItem.kind === 'branch'
                                ? handleAcceptBranchSuggestion
                                : activeInlineItem.kind === 'branch_extract'
                                  ? handleAcceptBranchExtractSuggestion
                                  : activeInlineItem.kind === 'return_parent'
                                    ? handleAcceptReturnSuggestion
                                    : handleAcceptExtractSuggestion
                            }
                            disabled={structureActionInFlight !== null}
                            className={clsx(
                              "px-3 py-1.5 rounded-md text-xs font-medium !text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed",
                              activeInlineItem.kind === 'return_parent'
                                ? 'bg-indigo-700 hover:bg-indigo-800'
                                : 'bg-zinc-900 hover:bg-zinc-800'
                            )}
                            style={{ color: '#fff' }}
                          >
                            {structureActionInFlight === 'return' && activeInlineItem.kind === 'return_parent'
                              ? 'Returning...'
                              : structureActionInFlight === 'extract' &&
                                  (activeInlineItem.kind === 'branch_extract' || activeInlineItem.kind === 'structure_extract')
                                ? 'Extracting...'
                                : activeInlineItem.cta}
                          </button>
                        </div>
                      </div>
                      {inlineSuggestionItems.length > 1 && (
                        <div className="mt-3 flex items-center justify-center gap-3">
                          <button
                            onClick={() => goToPreviousInlineSuggestion(inlineSuggestionItems.length)}
                            disabled={structureActionInFlight !== null}
                            className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label="Previous suggestion"
                          >
                            <ChevronLeft size={18} />
                          </button>
                          <span className="min-w-10 text-center text-sm font-medium text-zinc-600 tabular-nums">
                            {clampInlineSuggestionIndex(activeInlineSuggestionIndex, inlineSuggestionItems.length) + 1}/{inlineSuggestionItems.length}
                          </span>
                          <button
                            onClick={() => goToNextInlineSuggestion(inlineSuggestionItems.length)}
                            disabled={structureActionInFlight !== null}
                            className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label="Next suggestion"
                          >
                            <ChevronRight size={18} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={endOfMessagesRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-zinc-200 space-y-3">
        <div className="max-w-3xl mx-auto overflow-x-auto">
          <div className="flex items-center gap-2 min-h-8">
            {globalPatternList.length === 0 ? (
              <span className="text-xs text-zinc-400">No patterns yet.</span>
            ) : (
              <>
                {visiblePatternList.map((pattern) => {
                const isEnabled = context.enabled_patterns_by_type[pattern.type] === pattern.pattern_id;
                const needsReview = pattern.requires_human_review && pattern.review_status !== 'approved';
                return (
                  <div key={pattern.pattern_id} className="flex items-center gap-1">
                    <button
                      onClick={() => handleTogglePatternEnabled(pattern)}
                      onDoubleClick={() => openPatternPanel(pattern.pattern_id)}
                      className={clsx(
                        'px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-colors',
                        isEnabled
                          ? needsReview
                            ? 'bg-zinc-900 !text-white border-amber-300'
                            : 'bg-zinc-900 !text-white border-zinc-900'
                          : needsReview
                            ? 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
                            : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-100'
                      )}
                      title={needsReview ? 'Needs review before enabling' : 'Toggle pattern for next prompt'}
                    >
                      <span className={clsx(isEnabled && '!text-white')}>
                        {PATTERN_TYPE_LABEL[pattern.type]} · {pattern.name}
                      </span>
                    </button>
                  </div>
                );
              })}
                <div className="ml-auto flex items-center gap-1.5 pl-2">
                  {totalPatternPages > 1 && (
                    <>
                      <button
                        onClick={() => setPatternPage((prev) => Math.max(0, prev - 1))}
                        disabled={patternPage === 0}
                        className="h-8 w-8 rounded-full border border-zinc-300 text-zinc-600 hover:bg-zinc-100 disabled:text-zinc-300 disabled:hover:bg-transparent"
                        aria-label="Previous patterns page"
                      >
                        <ChevronLeft size={15} className="mx-auto" />
                      </button>
                      <span className="text-[11px] text-zinc-500 tabular-nums">
                        {patternPage + 1}/{totalPatternPages}
                      </span>
                      <button
                        onClick={() => setPatternPage((prev) => Math.min(totalPatternPages - 1, prev + 1))}
                        disabled={patternPage >= totalPatternPages - 1}
                        className="h-8 w-8 rounded-full border border-zinc-300 text-zinc-600 hover:bg-zinc-100 disabled:text-zinc-300 disabled:hover:bg-transparent"
                        aria-label="Next patterns page"
                      >
                        <ChevronRight size={15} className="mx-auto" />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => {
                      setIsPatternLibraryOpen(true);
                      if (!viewingPatternId && globalPatternList[0]) {
                        setViewingPatternId(globalPatternList[0].pattern_id);
                      }
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-zinc-300 px-3 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100"
                  >
                    <Rows3 size={14} />
                    All Patterns
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {contextReturnProposals.length > 0 && (
          <div className="max-w-3xl mx-auto mb-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950" aria-label="Context return suggestions">
            <div className="font-semibold">Context steward · earlier branches</div>
            <div className="mt-1 text-xs text-indigo-700">Review what to bring into this turn. Your choice shapes future suggestions.</div>
            {contextReturnProposals.map((proposal) => (
              <div key={proposal.branchId} className="mt-2 rounded-lg bg-white px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium" title={proposal.reason}>{proposal.label}</span>
                  <button type="button" className="rounded-md bg-indigo-700 px-2 py-1 text-xs text-white" onClick={() => {
                    const fresh = useAppStore.getState();
                    const freshProject = fresh.projects[project.project_id];
                    const freshContext = freshProject ? fresh.contexts[freshProject.active_context_id] : null;
                    if (!freshContext) return;
                    const review = reviewContextProposal({
                      proposal,
                      context: freshContext,
                      graph: buildContextGraph(project.project_id, fresh.nodes, fresh.branches),
                    });
                    if (!review.valid) { setBranchSuggestionNotice(review.reason || 'Context changed.'); return; }
                    batchToggleInclusion(project.project_id, review.nodeIds, 'include');
                    recordContextChoice(window.localStorage, project.project_id, { query: input, branchId: proposal.branchId, decision: 'accepted', at: new Date().toISOString() });
                  }}>Include {proposal.nodeIds.length}</button>
                  <button type="button" className="rounded-md px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100" onClick={() => {
                  recordContextChoice(window.localStorage, project.project_id, { query: input, branchId: proposal.branchId, decision: 'rejected', at: new Date().toISOString() });
                  setDismissedContextBranchIds((previous) => [...previous, proposal.branchId]);
                  }}>Skip</button>
                </div>
                <div className="mt-1 space-y-1 text-xs text-zinc-600">
                  {proposal.nodeIds.map((id) => <p key={id} className="line-clamp-2">{nodes[id]?.content.slice(0, 180)}</p>)}
                </div>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={handleSend} className="max-w-3xl mx-auto relative flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => { setInput(e.target.value); setDismissedContextBranchIds([]); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
            placeholder="Type a message... (Shift+Enter for new line)"
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
            className="absolute right-3 bottom-3 p-2 rounded-lg transition-colors disabled:cursor-not-allowed"
            style={input.trim() && !isLoading ? { backgroundColor: '#18181b', color: '#fff' } : { backgroundColor: '#d4d4d8', color: '#52525b' }}
          >
            <Send size={18} />
          </button>
        </form>
      </div>

      {isPatternLibraryOpen && viewingPatternId && patterns[viewingPatternId] && (
        <div className="absolute inset-0 z-30 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl bg-white rounded-xl shadow-xl border border-zinc-200 p-5 max-h-[88vh] overflow-hidden">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-zinc-900">Pattern Library</h3>
              <button
                onClick={() => setIsPatternLibraryOpen(false)}
                className="p-1 rounded hover:bg-zinc-100 text-zinc-600"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mt-4 grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-2 max-h-[72vh] overflow-y-auto">
                <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                  Patterns
                </div>
                <div className="space-y-1.5">
                  {globalPatternList.map((pattern) => {
                    const isActive = pattern.pattern_id === viewingPatternId;
                    return (
                      <button
                        key={pattern.pattern_id}
                        onClick={() => setViewingPatternId(pattern.pattern_id)}
                        className={clsx(
                          "w-full rounded-2xl border px-3 py-2 text-left transition-colors",
                          isActive
                            ? "border-zinc-900 bg-zinc-900 text-white"
                            : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"
                        )}
                      >
                        <div
                          className={clsx(
                            "text-[11px] font-semibold uppercase tracking-[0.18em]",
                            isActive ? "text-white/75" : "text-zinc-500"
                          )}
                        >
                          {PATTERN_TYPE_LABEL[pattern.type]}
                        </div>
                        <div
                          className={clsx(
                            "mt-1 text-sm font-medium truncate",
                            isActive ? "text-white" : "text-zinc-900"
                          )}
                        >
                          {pattern.name}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="max-h-[72vh] overflow-y-auto rounded-2xl border border-zinc-200 p-4">
                {renderPatternEditor()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
