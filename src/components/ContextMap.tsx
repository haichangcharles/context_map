import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useAppStore } from '../store';
import { ReactFlow, Background, Controls, Node as FlowNode, Edge, Position, MarkerType, useNodesState, useEdgesState, Handle, ReactFlowInstance, SelectionMode, applyNodeChanges, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Node, Branch, PatternType, SelectionNotice, DeleteSelectionPreview } from '../types';
import clsx from 'clsx';
import { Layers, Eye, EyeOff, GitBranch, MousePointerSquareDashed, WandSparkles, Undo2, Redo2, RotateCcw, History, ArrowRightLeft, Sparkles, X, Info, CheckCircle2, TriangleAlert, CircleAlert, Trash2 } from 'lucide-react';
import dagre from 'dagre';
import { buildQAPair, logBranchDebug, logContextMapDebug, QAPair, setPendingBranchFeedback } from '../utils/branchFeedbackDataset';
import { extractPatternByType } from '../services/gemini';
import { CONTEXT_MAP_SELECTION_BODY_CLASS, syncBodyClassToggle } from '../utils/contextMapInteraction';

// Custom Node Component
const CustomNode = ({ data }: { data: any }) => {
  const isExcluded = data.isExcluded;
  const isIncluded = data.isIncluded;
  const isActive = data.isActive; // In the current base path
  const isSelectedStart = data.isSelectedStart;
  const isSelected = data.isSelected;
  const isDeleteSelected = data.isDeleteSelected;
  const isPlaceholder = data.isPlaceholder;
  
  return (
    <div 
      className={clsx(
        "px-3 py-2 shadow-md rounded-md border-2 text-xs w-48 transition-all cursor-pointer relative",
        isActive ? "border-indigo-500 bg-indigo-50" : "border-zinc-200 bg-white",
        isExcluded && "opacity-50 border-dashed border-red-300 bg-red-50",
        isIncluded && !isActive && "border-emerald-500 bg-emerald-50",
        isSelected && !isDeleteSelected && "border-sky-500 ring-2 ring-sky-300 ring-offset-1 shadow-[0_0_0_1px_rgba(14,165,233,0.25)]",
        isDeleteSelected && "border-rose-500 ring-2 ring-rose-300 ring-offset-1 shadow-[0_0_0_1px_rgba(244,63,94,0.22)]",
        isPlaceholder && "border-amber-400 bg-amber-50 ring-2 ring-amber-200 ring-offset-1",
        isSelectedStart && "ring-4 ring-orange-400 ring-offset-2"
      )}
      onContextMenu={data.onContextMenu}
    >
      <Handle type="target" position={Position.Top} className="w-2 h-2 bg-zinc-400" />
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-zinc-700 uppercase tracking-wider text-[10px]">
          {data.role}
        </span>
        {isExcluded ? <EyeOff size={12} className="text-red-400" /> : <Eye size={12} className="text-zinc-400" />}
      </div>
      <div className="text-zinc-600 truncate">
        {data.content}
      </div>
      {isSelected && (
        <div className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-white font-medium leading-none">
          ✓
        </div>
      )}
      {data.branchId && (
        <div className="mt-1 flex items-center gap-1 text-[9px] text-indigo-600 bg-indigo-100 px-1 py-0.5 rounded-sm w-fit">
          <GitBranch size={10} />
          Branch
        </div>
      )}
      {isPlaceholder && (
        <div className="mt-1 flex items-center gap-1 text-[9px] text-amber-700 bg-amber-100 px-1 py-0.5 rounded-sm w-fit">
          Placeholder
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-zinc-400" />
      <Handle type="target" position={Position.Left} id="left" className="w-2 h-2 bg-indigo-400" />
      <Handle type="source" position={Position.Left} id="left" className="w-2 h-2 bg-indigo-400" />
      <Handle type="target" position={Position.Right} id="right" className="w-2 h-2 bg-indigo-400" />
      <Handle type="source" position={Position.Right} id="right" className="w-2 h-2 bg-indigo-400" />
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

type LayoutMode = 'tree' | 'mindmap' | 'timeline';
type BranchSide = 'left' | 'right';
type BranchGroup = { branch: Branch; branchNodes: Node[] };
const PATTERN_TYPE_ORDER: PatternType[] = ['reasoning', 'task_sop', 'context_case'];
const PATTERN_TYPE_LABEL: Record<PatternType, string> = {
  reasoning: 'Reasoning',
  task_sop: 'Task SOP',
  context_case: 'Context Case',
};
const SELECTION_ACTIVE_SURFACE = 'bg-[#3a3a3c] border-[#3a3a3c] text-white';
const DELETE_ACTIVE_SURFACE = 'bg-rose-600 border-rose-600 text-white';

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

const summarizeRecent = (items: string[], max = 160): string => {
  const merged = items
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-2)
    .join(' | ');
  return merged.slice(0, max);
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

const getCurrentLevel = (isMainline: boolean, currentBranch: Branch | null, allBranches: Record<string, Branch>): number => {
  if (isMainline || !currentBranch) return 1;
  return getBranchChainIds(currentBranch.branch_id, allBranches).length + 1;
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

const getLayoutedElements = (nodes: FlowNode[], edges: Edge[], direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const isHorizontal = direction === 'LR';
  dagreGraph.setGraph({ rankdir: direction, nodesep: 50, ranksep: 80 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 192, height: 80 }); // 48 * 4 = 192px width approx
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const newNode = {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: nodeWithPosition.x - 192 / 2,
        y: nodeWithPosition.y - 80 / 2,
      },
    };

    return newNode;
  });

  return { nodes: newNodes, edges };
};

const getStructuredPositions = (
  nodes: FlowNode[],
  mainlineNodeIds: string[],
  branchGroups: BranchGroup[],
  branchSideById: Map<string, BranchSide>,
  mode: Exclude<LayoutMode, 'tree'>
) => {
  const positions = new Map<string, { x: number; y: number }>();
  const mainlineStepY = 170;
  const branchStepY = 130;
  const branchStepX = 240;
  const mainlineX = mode === 'mindmap' ? -420 : 0;
  const laneCountBySide = { left: 0, right: 0 };
  const mainlineSet = new Set(mainlineNodeIds);
  const branchNodeSet = new Set(branchGroups.flatMap((g) => g.branchNodes.map((n) => n.node_id)));
  const anchorToGroups = new Map<string, BranchGroup[]>();

  branchGroups.forEach((group) => {
    const key = group.branch.anchor_node_id;
    if (!anchorToGroups.has(key)) {
      anchorToGroups.set(key, []);
    }
    anchorToGroups.get(key)!.push(group);
  });

  mainlineNodeIds.forEach((nodeId, index) => {
    positions.set(nodeId, { x: mainlineX, y: index * mainlineStepY });
  });

  if (mode === 'timeline') {
    const siblingLaneByAnchorSide = new Map<string, number>();
    let remaining = [...branchGroups];
    let guard = 0;

    while (remaining.length > 0 && guard < branchGroups.length + 5) {
      guard += 1;
      const next: BranchGroup[] = [];
      let progressed = false;

      remaining.forEach((group) => {
        const anchorPos = positions.get(group.branch.anchor_node_id);
        if (!anchorPos) {
          next.push(group);
          return;
        }

        const side = branchSideById.get(group.branch.branch_id) || 'right';
        const laneKey = `${group.branch.anchor_node_id}:${side}`;
        const lane = siblingLaneByAnchorSide.get(laneKey) || 0;
        siblingLaneByAnchorSide.set(laneKey, lane + 1);

        const x = anchorPos.x + (side === 'left' ? -1 : 1) * (360 + lane * 220);
        const y0 = anchorPos.y + lane * 28;

        group.branchNodes.forEach((node, index) => {
          positions.set(node.node_id, {
            x,
            y: y0 + index * branchStepY,
          });
        });
        progressed = true;
      });

      if (!progressed) {
        next.forEach((group) => {
          const side = branchSideById.get(group.branch.branch_id) || 'right';
          const anchorIndex = mainlineNodeIds.indexOf(group.branch.anchor_node_id);
          const fallbackY = anchorIndex === -1 ? 0 : anchorIndex * mainlineStepY;
          const x = (side === 'left' ? -1 : 1) * 360;
          group.branchNodes.forEach((node, index) => {
            positions.set(node.node_id, { x, y: fallbackY + index * branchStepY });
          });
        });
        remaining = [];
      } else {
        remaining = next;
      }
    }
  } else {
    branchGroups.forEach((group, groupIndex) => {
      const side = branchSideById.get(group.branch.branch_id) || 'right';
      const lane = laneCountBySide[side]++;
      const anchorIndex = mainlineNodeIds.indexOf(group.branch.anchor_node_id);
      const anchorY = anchorIndex === -1 ? 0 : anchorIndex * mainlineStepY;

      const x = mode === 'mindmap' ? mainlineX + 420 + lane * 220 : (side === 'left' ? -1 : 1) * (380 + lane * 220);
      const verticalOffset = mode === 'mindmap' ? (groupIndex % 3) * 24 : (lane % 2) * 20;

      group.branchNodes.forEach((node, index) => {
        if (mode === 'mindmap') {
          const siblings = anchorToGroups.get(group.branch.anchor_node_id) || [group];
          const siblingIndex = siblings.findIndex((g) => g.branch.branch_id === group.branch.branch_id);
          const centeredIndex = siblingIndex - (siblings.length - 1) / 2;
          const yBase = anchorY + centeredIndex * 150;
          // Mindmap UX: branch chains flow horizontally to the right.
          positions.set(node.node_id, {
            x: mainlineX + 420 + index * branchStepX,
            y: yBase,
          });
        } else {
          positions.set(node.node_id, {
            x,
            y: anchorY + index * branchStepY + verticalOffset,
          });
        }
      });
    });
  }

  return nodes.map((node) => {
    if (mode === 'mindmap') {
      const isMainline = mainlineSet.has(node.id);
      const isBranchNode = branchNodeSet.has(node.id);
      return {
        ...node,
        targetPosition: isMainline ? Position.Top : isBranchNode ? Position.Left : Position.Top,
        sourcePosition: isMainline ? Position.Bottom : isBranchNode ? Position.Right : Position.Bottom,
        position: positions.get(node.id) || node.position,
      };
    }

    return {
      ...node,
      targetPosition: Position.Top,
      sourcePosition: Position.Bottom,
      position: positions.get(node.id) || node.position,
    };
  });
};

export default function ContextMap() {
  const {
    projects, activeProjectId, nodes, branches, mainlines, contexts,
    cycleNodeInclusionState, setMainlineEndpoints, createBranch, jumpToNode, batchToggleInclusion,
    pastStructureSnapshots, futureStructureSnapshots, undoStructureChange, redoStructureChange, resetStructureToNatural, naturalMainlines,
    createPattern, previewDeleteSelectedNodes, deleteSelectedNodes,
    isNodeSelectionMode, nodeSelectionIntent, selectedNodeIds, startNodeSelectionMode, finishNodeSelectionMode, clearNodeSelection, toggleNodeSelection, applyNodeSelectionChanges
  } = useAppStore();
  
  const [flowNodes, setFlowNodes] = useNodesState([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState([]);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('tree');
  const [layoutRefreshToken, setLayoutRefreshToken] = useState(0);
  
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, nodeId: string } | null>(null);
  const [selectedStartId, setSelectedStartId] = useState<string | null>(null);
  const [pendingPatternType, setPendingPatternType] = useState<PatternType>('reasoning');
  const [isExtractingPattern, setIsExtractingPattern] = useState(false);
  const [pendingDeletePreview, setPendingDeletePreview] = useState<DeleteSelectionPreview | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<SelectionNotice | null>(null);
  const [isSelectionNoticeExpanded, setIsSelectionNoticeExpanded] = useState(false);
  
  const [rfInstance, setRfInstance] = useState<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previousLayoutModeRef = useRef<LayoutMode>('tree');
  const previousLayoutRefreshTokenRef = useRef(0);
  const previousStructureSignatureRef = useRef<string>('');
  const liveProject = activeProjectId ? projects[activeProjectId] : null;
  const liveContext = liveProject ? contexts[liveProject.active_context_id] : null;
  const previewState = pendingDeletePreview?.candidate ?? null;
  const renderProjects = previewState?.projects ?? projects;
  const renderNodes = previewState?.nodes ?? nodes;
  const renderBranches = previewState?.branches ?? branches;
  const renderMainlines = previewState?.mainlines ?? mainlines;
  const renderContexts = previewState?.contexts ?? contexts;
  const renderProject = activeProjectId ? renderProjects[activeProjectId] : null;
  const renderContext = renderProject ? renderContexts[renderProject.active_context_id] : null;
  const previewNodeVariants = pendingDeletePreview?.nodeVariants ?? {};
  const isDeletePreviewActive = !!pendingDeletePreview;
  const project = liveProject;
  const context = liveContext;
  const isSelectionMode = isNodeSelectionMode;
  const selectionIntent = nodeSelectionIntent;

  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    syncBodyClassToggle(document.body, CONTEXT_MAP_SELECTION_BODY_CLASS, isSelectionMode);
    return () => {
      syncBodyClassToggle(document.body, CONTEXT_MAP_SELECTION_BODY_CLASS, false);
    };
  }, [isSelectionMode]);

  const emitSelectionNotice = useCallback((notice: SelectionNotice | null) => {
    setSelectionNotice(notice);
    setIsSelectionNoticeExpanded(notice?.defaultExpanded ?? false);
  }, []);

  const clearSelectionState = useCallback(() => {
    clearNodeSelection();
    setPendingDeletePreview(null);
  }, [clearNodeSelection]);

  const finishSelectionMode = useCallback((options: { preserveNotice?: boolean } = {}) => {
    clearSelectionState();
    finishNodeSelectionMode();
    if (!options.preserveNotice) {
      emitSelectionNotice(null);
    }
  }, [clearSelectionState, emitSelectionNotice, finishNodeSelectionMode]);

  const onPaneClick = useCallback((event: React.MouseEvent) => {
    if (isDeletePreviewActive) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.react-flow__node')) {
      return;
    }
    setContextMenu(null);
    if (isSelectionMode) {
      clearSelectionState();
    }
  }, [clearSelectionState, isSelectionMode, isDeletePreviewActive]);

  const handleSelectionAction = useCallback((event: React.MouseEvent, nodeId: string) => {
    event.stopPropagation();
    event.preventDefault();
    toggleNodeSelection(nodeId);
  }, [toggleNodeSelection]);

  const handleNodePrimaryAction = useCallback((event: React.MouseEvent, nodeId: string) => {
    if (isDeletePreviewActive) return;
    setContextMenu(null);
    if (!liveProject) return;
    if (isSelectionMode) {
      handleSelectionAction(event, nodeId);
      return;
    }
    cycleNodeInclusionState(liveProject.project_id, nodeId);
  }, [isDeletePreviewActive, liveProject, isSelectionMode, handleSelectionAction, cycleNodeInclusionState]);

  const handleFlowNodesChange = useCallback((changes: NodeChange[]) => {
    const selectChanges = changes.filter((change): change is Extract<NodeChange, { type: 'select' }> => change.type === 'select');
    if (isSelectionMode && selectChanges.length > 0) {
      applyNodeSelectionChanges(selectChanges.map((change) => ({ id: change.id, selected: change.selected })));
    }
    setFlowNodes((prev) => {
      const next = applyNodeChanges(changes.filter((change) => change.type !== 'select'), prev);
      return next.map((n) => ({
        ...n,
        selected: false,
        data: {
          ...n.data,
          isSelected: selectedNodeIdSet.has(n.id),
          isDeleteSelected: selectionIntent === 'delete' && selectedNodeIdSet.has(n.id),
          selectionIndex: undefined,
        },
      }));
    });
  }, [applyNodeSelectionChanges, isSelectionMode, selectedNodeIdSet, selectionIntent, setFlowNodes]);

  const resolvedMainlineNodeIds = useMemo(() => {
    if (!renderProject) return [] as string[];
    const rawMainline = renderMainlines[renderProject.project_id] || [];
    const validMainline = rawMainline.filter((id) => renderNodes[id]?.project_id === renderProject.project_id);
    if (validMainline.length > 0) return validMainline;

    if (rawMainline.length > 0 && validMainline.length === 0) {
      console.warn('[context-map] all mainline IDs are invalid; falling back to branch_id===null nodes', {
        projectId: renderProject.project_id,
        rawMainlineLength: rawMainline.length,
      });
    }

    const fallbackMainline = Object.values(renderNodes)
      .filter((n) => n.project_id === renderProject.project_id && n.branch_id === null)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((n) => n.node_id);
    if (fallbackMainline.length > 0) return fallbackMainline;

    const allProjectNodes = Object.values(renderNodes)
      .filter((n) => n.project_id === renderProject.project_id)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    if (allProjectNodes.length > 0) {
      console.warn('[context-map] mainline fallback to earliest project node', {
        projectId: renderProject.project_id,
        totalProjectNodes: allProjectNodes.length,
      });
      return [allProjectNodes[0].node_id];
    }
    return [];
  }, [renderProject, renderMainlines, renderNodes]);

  const activeNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!renderProject || !renderContext) return ids;
    const isMainline = renderContext.base_path === 'mainline';
    const currentBranch = !isMainline ? renderBranches[renderContext.base_path] : null;

    if (isMainline) {
      resolvedMainlineNodeIds.forEach(id => ids.add(id));
    } else if (currentBranch) {
      const branchChainIds = getBranchChainIds(currentBranch.branch_id, renderBranches);
      const rootBranchId = branchChainIds[0];
      const rootBranch = rootBranchId ? renderBranches[rootBranchId] : null;
      const anchorIndex = rootBranch ? resolvedMainlineNodeIds.indexOf(rootBranch.anchor_node_id) : -1;
      if (anchorIndex !== -1) {
        resolvedMainlineNodeIds.slice(0, anchorIndex + 1).forEach(id => ids.add(id));
      } else {
        resolvedMainlineNodeIds.forEach(id => ids.add(id));
      }
      branchChainIds.forEach((branchId) => {
        Object.values(renderNodes)
          .filter((n) => n.branch_id === branchId)
          .forEach((n) => ids.add(n.node_id));
      });
    }
    return ids;
  }, [renderProject, renderContext, resolvedMainlineNodeIds, renderBranches, renderNodes]);

  const projectNodeCount = useMemo(() => {
    if (!renderProject) return 0;
    return Object.values(renderNodes).filter((n) => n.project_id === renderProject.project_id).length;
  }, [renderProject, renderNodes]);

  const getViewportSnapshot = useCallback(() => {
    if (!rfInstance) return null;
    try {
      const viewport = rfInstance.getViewport?.();
      const rfNodes = rfInstance.getNodes?.();
      const rfNodesCount = Array.isArray(rfNodes) ? rfNodes.length : 0;
      return {
        viewport: viewport
          ? {
              x: viewport.x,
              y: viewport.y,
              zoom: viewport.zoom,
            }
          : null,
        rfNodesCount,
      };
    } catch {
      return null;
    }
  }, [rfInstance]);

  useEffect(() => {
    if (!renderProject || !renderContext) return;

    const mainlineNodeIds = resolvedMainlineNodeIds;
    const modeChanged = previousLayoutModeRef.current !== layoutMode;
    const relayoutRequested = previousLayoutRefreshTokenRef.current !== layoutRefreshToken;

    const projectNodes = Object.values(renderNodes).filter((n) => n.project_id === renderProject.project_id);
    const projectBranches = Object.values(renderBranches).filter((branch) => branch.project_id === renderProject.project_id);

    const structureSignature = JSON.stringify({
      source: isDeletePreviewActive ? 'preview' : 'live',
      mainline: mainlineNodeIds,
      projectNodes: projectNodes
        .map((n) => `${n.node_id}:${n.parent_id ?? 'null'}:${n.branch_id ?? 'mainline'}`)
        .sort(),
      branches: projectBranches
        .map((b) => `${b.branch_id}:${b.anchor_node_id}`)
        .sort(),
    });
    const structureChanged = previousStructureSignatureRef.current !== structureSignature;

    if (!structureChanged && !modeChanged && !relayoutRequested) {
      setFlowNodes((prevNodes) => {
        if (prevNodes.length === 0) return prevNodes;
        let changed = false;
        const updated = prevNodes.map((fn) => {
          const currentNode = renderNodes[fn.id];
          if (!currentNode) return fn;
          const nextIsActive = activeNodeIds.has(fn.id);
          const nextIsExcluded = renderContext.excluded_nodes.includes(fn.id);
          const nextIsIncluded = renderContext.included_nodes.includes(fn.id);
          const nextIsSelectedStart = fn.id === selectedStartId;
          const nextIsSelected = selectedNodeIdSet.has(fn.id);
          const nextIsDeleteSelected = selectionIntent === 'delete' && nextIsSelected;
          const nextIsPlaceholder = currentNode.metadata.is_delete_placeholder || previewNodeVariants[fn.id] === 'placeholder';
          const dataChanged =
            fn.data.content !== currentNode.content ||
            fn.data.isActive !== nextIsActive ||
            fn.data.isExcluded !== nextIsExcluded ||
            fn.data.isIncluded !== nextIsIncluded ||
            fn.data.isSelectedStart !== nextIsSelectedStart ||
            fn.data.isSelected !== nextIsSelected ||
            fn.data.isDeleteSelected !== nextIsDeleteSelected ||
            fn.data.isPlaceholder !== nextIsPlaceholder;
          if (!dataChanged) return fn;
          changed = true;
          return {
            ...fn,
            selected: false,
            data: {
              ...fn.data,
              content: currentNode.content,
              isActive: nextIsActive,
              isExcluded: nextIsExcluded,
              isIncluded: nextIsIncluded,
              isSelectedStart: nextIsSelectedStart,
              isSelected: nextIsSelected,
              isDeleteSelected: nextIsDeleteSelected,
              isPlaceholder: nextIsPlaceholder,
              selectionIndex: undefined,
            },
          };
        });
        return changed ? updated : prevNodes;
      });
      return;
    }

    previousLayoutModeRef.current = layoutMode;
    previousLayoutRefreshTokenRef.current = layoutRefreshToken;
    previousStructureSignatureRef.current = structureSignature;

    const initialNodes: FlowNode[] = [];
    const initialEdges: Edge[] = [];

    const projectBranchIds = new Set(projectBranches.map((branch) => branch.branch_id));

    if (projectNodes.length > 0 && mainlineNodeIds.length === 0) {
      console.warn('[context-map] project has nodes but resolved mainline is empty', {
        projectId: renderProject.project_id,
        projectNodeCount: projectNodes.length,
      });
    }

    const orphanNodesByBranchId = new Map<string, Node[]>();
    projectNodes.forEach((node) => {
      if (!node.branch_id || projectBranchIds.has(node.branch_id)) return;
      if (!orphanNodesByBranchId.has(node.branch_id)) {
        orphanNodesByBranchId.set(node.branch_id, []);
      }
      orphanNodesByBranchId.get(node.branch_id)!.push(node);
    });

    if (orphanNodesByBranchId.size > 0) {
      console.warn('[context-map] rendering orphan branch groups', {
        projectId: renderProject.project_id,
        orphanBranchCount: orphanNodesByBranchId.size,
      });
    }

    const syntheticOrphanBranches: Branch[] = Array.from(orphanNodesByBranchId.entries()).map(([branchId, orphanNodes]) => {
      const sorted = [...orphanNodes].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const firstNode = sorted[0];
      const anchorNodeId =
        (firstNode.parent_id && renderNodes[firstNode.parent_id]?.project_id === renderProject.project_id
          ? firstNode.parent_id
          : null) ||
        mainlineNodeIds[0] ||
        firstNode.node_id;

      return {
        branch_id: branchId,
        project_id: renderProject.project_id,
        anchor_node_id: anchorNodeId,
        parent_branch_id: null,
        status: 'active',
      };
    });

    const projectBranchGroups: BranchGroup[] = [...projectBranches, ...syntheticOrphanBranches]
      .map((branch) => ({
        branch,
        branchNodes: projectNodes
          .filter((n) => n.branch_id === branch.branch_id)
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
      }))
      .filter((group) => group.branchNodes.length > 0 && !!renderNodes[group.branch.anchor_node_id])
      .sort((a, b) => {
        const aIndex = mainlineNodeIds.indexOf(a.branch.anchor_node_id);
        const bIndex = mainlineNodeIds.indexOf(b.branch.anchor_node_id);
        if (aIndex !== bIndex) return aIndex - bIndex;
        return new Date(a.branchNodes[0].timestamp).getTime() - new Date(b.branchNodes[0].timestamp).getTime();
      });

    const branchSideById = new Map<string, BranchSide>();
    if (layoutMode === 'mindmap') {
      projectBranchGroups.forEach((group) => {
        branchSideById.set(group.branch.branch_id, 'right');
      });
    } else if (layoutMode === 'timeline') {
      const sideWeights = { left: 0, right: 0 };
      const nodeToBranchId = new Map<string, string>();
      projectBranchGroups.forEach((group) => {
        group.branchNodes.forEach((node) => nodeToBranchId.set(node.node_id, group.branch.branch_id));
      });

      let remaining = [...projectBranchGroups];
      let guard = 0;
      while (remaining.length > 0 && guard < projectBranchGroups.length + 5) {
        guard += 1;
        const next: BranchGroup[] = [];
        let progressed = false;

        remaining.forEach((group) => {
          const anchorBranchId = nodeToBranchId.get(group.branch.anchor_node_id);
          if (anchorBranchId && !branchSideById.has(anchorBranchId)) {
            next.push(group);
            return;
          }

          let side: BranchSide;
          if (anchorBranchId) {
            side = branchSideById.get(anchorBranchId)!;
          } else {
            side = sideWeights.left <= sideWeights.right ? 'left' : 'right';
          }

          branchSideById.set(group.branch.branch_id, side);
          sideWeights[side] += Math.max(1, group.branchNodes.length);
          progressed = true;
        });

        if (!progressed) {
          next.forEach((group, index) => {
            branchSideById.set(group.branch.branch_id, index % 2 === 0 ? 'left' : 'right');
          });
          remaining = [];
        } else {
          remaining = next;
        }
      }
    } else {
      projectBranchGroups.forEach((group) => {
        branchSideById.set(group.branch.branch_id, 'right');
      });
    }

    const handleContextMenu = (e: React.MouseEvent, nodeId: string) => {
      if (isDeletePreviewActive) return;
      e.preventDefault();
      
      const menuWidth = 180;
      const menuHeight = 160;
      
      let x = e.clientX;
      let y = e.clientY;
      
      if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 10;
      }
      if (y + menuHeight > window.innerHeight) {
        y = window.innerHeight - menuHeight - 10;
      }
      
      setContextMenu({ x, y, nodeId });
    };

    // Place mainline nodes
    mainlineNodeIds.forEach((nodeId, index) => {
      const node = renderNodes[nodeId];
      if (!node) return;

      initialNodes.push({
        id: nodeId,
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          role: node.role,
          content: node.content,
          branchId: node.branch_id,
          isActive: activeNodeIds.has(nodeId),
          isExcluded: renderContext.excluded_nodes.includes(nodeId),
          isIncluded: renderContext.included_nodes.includes(nodeId),
          isSelectedStart: nodeId === selectedStartId,
          isSelected: selectedNodeIdSet.has(nodeId),
          isDeleteSelected: selectionIntent === 'delete' && selectedNodeIdSet.has(nodeId),
          isPlaceholder: node.metadata.is_delete_placeholder || previewNodeVariants[nodeId] === 'placeholder',
          selectionIndex: undefined,
          onPrimaryClick: (e: React.MouseEvent) => handleNodePrimaryAction(e, nodeId),
          onContextMenu: (e: React.MouseEvent) => handleContextMenu(e, nodeId),
        },
      });

      if (index > 0) {
        initialEdges.push({
          id: `e-${mainlineNodeIds[index-1]}-${nodeId}`,
          source: mainlineNodeIds[index-1],
          target: nodeId,
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed },
        });
      }
    });

    // Ensure all branch anchor nodes exist in initialNodes before adding branch nodes.
    const addedNodeIds = new Set(initialNodes.map((n) => n.id));
    projectBranchGroups.forEach(({ branch }) => {
      if (addedNodeIds.has(branch.anchor_node_id)) return;
      const anchorNode = renderNodes[branch.anchor_node_id];
      if (!anchorNode) return;
      initialNodes.push({
        id: branch.anchor_node_id,
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          role: anchorNode.role,
          content: anchorNode.content,
          branchId: anchorNode.branch_id,
          isActive: activeNodeIds.has(branch.anchor_node_id),
          isExcluded: renderContext.excluded_nodes.includes(branch.anchor_node_id),
          isIncluded: renderContext.included_nodes.includes(branch.anchor_node_id),
          isSelectedStart: branch.anchor_node_id === selectedStartId,
          isSelected: selectedNodeIdSet.has(branch.anchor_node_id),
          isDeleteSelected: selectionIntent === 'delete' && selectedNodeIdSet.has(branch.anchor_node_id),
          isPlaceholder: anchorNode.metadata.is_delete_placeholder || previewNodeVariants[branch.anchor_node_id] === 'placeholder',
          selectionIndex: undefined,
          onPrimaryClick: (e: React.MouseEvent) => handleNodePrimaryAction(e, branch.anchor_node_id),
          onContextMenu: (e: React.MouseEvent) => handleContextMenu(e, branch.anchor_node_id),
        },
      });
      addedNodeIds.add(branch.anchor_node_id);
    });

    // Place branch nodes
    projectBranchGroups.forEach(({ branch, branchNodes }) => {
      const side = branchSideById.get(branch.branch_id) || 'right';
      branchNodes.forEach((node, index) => {
        if (!addedNodeIds.has(node.node_id)) {
          initialNodes.push({
            id: node.node_id,
            type: 'custom',
            position: { x: 0, y: 0 },
            data: {
              role: node.role,
              content: node.content,
              branchId: node.branch_id,
              isActive: activeNodeIds.has(node.node_id),
              isExcluded: renderContext.excluded_nodes.includes(node.node_id),
              isIncluded: renderContext.included_nodes.includes(node.node_id),
              isSelectedStart: node.node_id === selectedStartId,
              isSelected: selectedNodeIdSet.has(node.node_id),
              isDeleteSelected: selectionIntent === 'delete' && selectedNodeIdSet.has(node.node_id),
              isPlaceholder: node.metadata.is_delete_placeholder || previewNodeVariants[node.node_id] === 'placeholder',
              selectionIndex: undefined,
              onPrimaryClick: (e: React.MouseEvent) => handleNodePrimaryAction(e, node.node_id),
              onContextMenu: (e: React.MouseEvent) => handleContextMenu(e, node.node_id),
            },
          });
          addedNodeIds.add(node.node_id);
        }

        if (index === 0) {
          if (addedNodeIds.has(branch.anchor_node_id)) {
            initialEdges.push({
              id: `e-${branch.anchor_node_id}-${node.node_id}`,
              source: branch.anchor_node_id,
              target: node.node_id,
              sourceHandle: layoutMode === 'tree' ? undefined : side === 'left' ? 'left' : 'right',
              targetHandle: layoutMode === 'tree' ? undefined : side === 'left' ? 'right' : 'left',
              type: 'smoothstep',
              animated: true,
              style: { stroke: '#6366f1', strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
            });
          }
        } else {
          initialEdges.push({
            id: `e-${branchNodes[index-1].node_id}-${node.node_id}`,
            source: branchNodes[index-1].node_id,
            target: node.node_id,
            sourceHandle: layoutMode === 'mindmap' ? 'right' : undefined,
            targetHandle: layoutMode === 'mindmap' ? 'left' : undefined,
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed },
          });
        }
      });
    });

    logContextMapDebug('layout-start', {
      projectId: renderProject.project_id,
      basePath: renderContext.base_path,
      projectNodeCount: projectNodes.length,
      mainlineNodeCount: mainlineNodeIds.length,
      branchGroupCount: projectBranchGroups.length,
      initialNodesCount: initialNodes.length,
      initialEdgesCount: initialEdges.length,
      layoutMode,
      structureChanged,
    });
    const startViewport = getViewportSnapshot();
    if (startViewport) {
      logContextMapDebug('viewport-snapshot', {
        phase: 'layout-start',
        projectId: renderProject.project_id,
        basePath: renderContext.base_path,
        ...startViewport,
      });
    }

    let layoutSuccess = false;
    try {
      const { nodes: dagreNodes, edges: layoutedEdges } = getLayoutedElements(initialNodes, initialEdges, 'TB');
      const structuredNodes =
        layoutMode === 'tree'
          ? dagreNodes
          : getStructuredPositions(dagreNodes, mainlineNodeIds, projectBranchGroups, branchSideById, layoutMode);

      logContextMapDebug('layout-result', {
        projectId: renderProject.project_id,
        basePath: renderContext.base_path,
        projectNodeCount: projectNodes.length,
        mainlineNodeCount: mainlineNodeIds.length,
        branchGroupCount: projectBranchGroups.length,
        initialNodesCount: initialNodes.length,
        initialEdgesCount: initialEdges.length,
        structuredNodesCount: structuredNodes.length,
        layoutMode,
        structureChanged,
      });
      const resultViewport = getViewportSnapshot();
      if (resultViewport) {
        logContextMapDebug('viewport-snapshot', {
          phase: 'layout-result',
          projectId: renderProject.project_id,
          basePath: renderContext.base_path,
          ...resultViewport,
        });
      }

      if (structuredNodes.length === 0 && initialNodes.length > 0) {
        console.warn('[context-map] layout produced 0 nodes from', initialNodes.length, 'initial nodes; skipping update');
      } else {
        setFlowNodes((prevNodes) => {
          if (structuredNodes.length === 0 && prevNodes.length > 0 && initialNodes.length > 0) {
            console.warn('[context-map] preventing flow node clear — keeping previous', prevNodes.length, 'nodes');
            return prevNodes;
          }
          const prevNodeById = new Map(prevNodes.map((n) => [n.id, n]));
          const nextNodes = structuredNodes.map((node) => {
            const prev = prevNodeById.get(node.id);
            const keepTreePosition = layoutMode === 'tree' && !modeChanged && !relayoutRequested && !structureChanged;
            const isSelected = selectedNodeIdSet.has(node.id);
            return {
              ...node,
              position: keepTreePosition && prev ? prev.position : node.position,
              selected: false,
              data: {
                ...node.data,
                isSelected,
                isDeleteSelected: selectionIntent === 'delete' && isSelected,
                isPlaceholder: renderNodes[node.id]?.metadata.is_delete_placeholder || previewNodeVariants[node.id] === 'placeholder',
                selectionIndex: undefined,
              },
            };
          });
          logContextMapDebug('flow-commit', {
            projectId: renderProject.project_id,
            basePath: renderContext.base_path,
            projectNodeCount: projectNodes.length,
            mainlineNodeCount: mainlineNodeIds.length,
            branchGroupCount: projectBranchGroups.length,
            initialNodesCount: initialNodes.length,
            initialEdgesCount: initialEdges.length,
            structuredNodesCount: structuredNodes.length,
            layoutMode,
            structureChanged,
            prevFlowNodesCount: prevNodes.length,
            nextFlowNodesCount: nextNodes.length,
          });
          const commitViewport = getViewportSnapshot();
          if (commitViewport) {
            logContextMapDebug('viewport-snapshot', {
              phase: 'flow-commit',
              projectId: renderProject.project_id,
              basePath: renderContext.base_path,
              ...commitViewport,
            });
          }
          return nextNodes;
        });
        setFlowEdges(layoutedEdges);
        layoutSuccess = true;
      }
    } catch (layoutError) {
      console.warn('[context-map] dagre layout failed; using fallback positioning', layoutError);
      const fallbackNodes = initialNodes.map((node, idx) => ({
        ...node,
        targetPosition: Position.Top,
        sourcePosition: Position.Bottom,
        position: { x: 0, y: idx * 120 },
      }));
      setFlowNodes(fallbackNodes.map((node) => ({
        ...node,
        selected: false,
        data: {
          ...node.data,
          isSelected: selectedNodeIdSet.has(node.id),
          isDeleteSelected: selectionIntent === 'delete' && selectedNodeIdSet.has(node.id),
          isPlaceholder: renderNodes[node.id]?.metadata.is_delete_placeholder || previewNodeVariants[node.id] === 'placeholder',
          selectionIndex: undefined,
        },
      })));
      setFlowEdges(initialEdges);
      layoutSuccess = true;
    }

    if (layoutSuccess && structureChanged && rfInstance) {
      window.requestAnimationFrame(() => {
        rfInstance.fitView({ duration: 300, padding: 0.15 });
      });
    }

  }, [renderNodes, renderBranches, renderMainlines, renderContexts, activeProjectId, selectedStartId, activeNodeIds, renderProject, renderContext, setFlowNodes, setFlowEdges, layoutMode, layoutRefreshToken, resolvedMainlineNodeIds, rfInstance, selectedNodeIdSet, selectionIntent, previewNodeVariants, isDeletePreviewActive, handleNodePrimaryAction]);

  // Auto fit view on nodes change
  useEffect(() => {
    if (rfInstance && flowNodes.length > 0) {
      window.requestAnimationFrame(() => {
        rfInstance.fitView({ duration: 500, padding: 0.1 });
      });
    }
  }, [flowNodes.length, rfInstance]); // Only trigger when node count changes

  useEffect(() => {
    if (!rfInstance || !renderProject || !renderContext || flowNodes.length === 0) return;
    window.requestAnimationFrame(() => {
      rfInstance.fitView({ duration: 250, padding: 0.12 });
    });
  }, [rfInstance, renderProject?.project_id, renderContext?.base_path, isDeletePreviewActive]);

  useEffect(() => {
    if (!rfInstance || !renderProject) return;
    if (projectNodeCount === 0 || flowNodes.length > 0) return;
    console.warn('[context-map] map appears empty while project has nodes; triggering recovery', {
      projectId: renderProject.project_id,
      projectNodeCount,
      flowNodesLength: flowNodes.length,
      resolvedMainlineLength: resolvedMainlineNodeIds.length,
      basePath: renderContext?.base_path,
    });
    setLayoutRefreshToken((n) => n + 1);
    window.requestAnimationFrame(() => {
      rfInstance.fitView({ duration: 300, padding: 0.15 });
    });
  }, [rfInstance, renderProject, projectNodeCount, flowNodes.length, resolvedMainlineNodeIds.length, renderContext?.base_path]);

  // Auto fit view on resize
  useEffect(() => {
    if (!rfInstance || !containerRef.current) return;
    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        rfInstance.fitView({ duration: 0, padding: 0.1 });
      });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [rfInstance]);

  const isBatchBusy = isExtractingPattern;
  const canUndoStructure = pastStructureSnapshots.length > 0;
  const canRedoStructure = futureStructureSnapshots.length > 0;
  const hasNaturalResetTarget = !!project && ((mainlines[project.project_id] || []).join('|') !== ((naturalMainlines[project.project_id] || []).join('|')));

  useEffect(() => {
    setPendingDeletePreview(null);
  }, [selectedNodeIds, selectionIntent]);

  const handleApplySelection = (action: 'include' | 'exclude') => {
    if (!project || !context) return;
    const selectedIds = [...selectedNodeIds];
    if (selectedIds.length === 0) return;
    batchToggleInclusion(project.project_id, selectedIds, action);
    finishSelectionMode();
  };

  const handleInvertSelection = () => {
    if (!project || selectedNodeIds.length === 0) return;
    selectedNodeIds.forEach((nodeId) => cycleNodeInclusionState(project.project_id, nodeId));
    finishSelectionMode();
  };

  const handleExtractPatternFromSelection = async () => {
    if (!project || selectedNodeIds.length === 0 || isBatchBusy) return;
    setIsExtractingPattern(true);
    try {
      const selectedNodes = selectedNodeIds
        .map((nodeId) => nodes[nodeId])
        .filter((n): n is Node => !!n)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      if (selectedNodes.length === 0) return;
      const extracted = await extractPatternByType(selectedNodes, pendingPatternType);
      createPattern({
        type: pendingPatternType,
        name: extracted.name,
        requires_human_review: extracted.requires_human_review,
        instruction: extracted.instruction,
        example: extracted.example,
        fromNodeId: selectedNodes[0].node_id,
        toNodeId: selectedNodes[selectedNodes.length - 1].node_id,
        sourceProjectId: project.project_id,
      });
      finishSelectionMode({ preserveNotice: true });
      emitSelectionNotice({
        id: `pattern-extracted-${Date.now()}`,
        tone: extracted.requires_human_review ? 'warning' : 'success',
        title: extracted.requires_human_review ? 'Pattern extracted for review' : 'Pattern extracted',
        message: extracted.requires_human_review
          ? 'The draft pattern is ready, but it still needs a quick human review before you enable it.'
          : 'The current selection was turned into a reusable pattern. You can inspect it from the chat pattern panel.',
        details: `Name: ${extracted.name}\nType: ${PATTERN_TYPE_LABEL[pendingPatternType]}\nRange: ${selectedNodes[0].node_id} -> ${selectedNodes[selectedNodes.length - 1].node_id}`,
        defaultExpanded: extracted.requires_human_review,
      });
    } catch (error) {
      console.error(error);
      finishSelectionMode({ preserveNotice: true });
      emitSelectionNotice({
        id: `pattern-error-${Date.now()}`,
        tone: 'error',
        title: 'Pattern extraction failed',
        message: 'The map could not turn this selection into a pattern draft.',
        details: 'Try a smaller, more coherent selection, or switch the pattern type before extracting again.',
        defaultExpanded: true,
      });
    } finally {
      setIsExtractingPattern(false);
    }
  };

  const handleStartSelectionMode = useCallback((intent: 'batch' | 'delete') => {
    clearSelectionState();
    setContextMenu(null);
    startNodeSelectionMode(intent);
  }, [clearSelectionState, startNodeSelectionMode]);

  const handleToggleSelectionMode = useCallback(() => {
    if (isSelectionMode && selectionIntent === 'batch') {
      finishSelectionMode();
      return;
    }
    handleStartSelectionMode('batch');
  }, [finishSelectionMode, handleStartSelectionMode, isSelectionMode, selectionIntent]);

  const handleDeleteButton = useCallback(() => {
    if (!project) return;
    if (!isSelectionMode || selectionIntent !== 'delete') {
      handleStartSelectionMode('delete');
      return;
    }
    if (selectedNodeIds.length === 0) {
      emitSelectionNotice({
        id: `delete-select-first-${Date.now()}`,
        tone: 'warning',
        title: 'Choose nodes to delete first',
        message: 'Delete mode is active. Click nodes to mark them for deletion, then preview the result.',
      });
      return;
    }
    const preview = previewDeleteSelectedNodes(project.project_id, selectedNodeIds);
    if (!preview) return;
    setPendingDeletePreview(preview);
  }, [project, isSelectionMode, selectionIntent, handleStartSelectionMode, selectedNodeIds, emitSelectionNotice, previewDeleteSelectedNodes]);

  const handleConfirmDelete = useCallback(() => {
    if (!project || selectedNodeIds.length === 0) return;
    const preview = deleteSelectedNodes(project.project_id, selectedNodeIds);
    if (!preview) return;
    finishSelectionMode({ preserveNotice: true });
    setPendingDeletePreview(null);
    emitSelectionNotice({
      id: `delete-confirmed-${Date.now()}`,
      tone: 'warning',
      title: 'Selection deleted',
      message: preview.requiresPlaceholder
        ? 'The selected nodes were removed and a placeholder was inserted to preserve the remaining branch structure.'
        : 'The selected nodes were removed and the remaining thread was stitched back together.',
      details: `${preview.summary}\nUse Undo to restore the previous structure if needed.`,
      defaultExpanded: true,
    });
  }, [project, selectedNodeIds, deleteSelectedNodes, finishSelectionMode, emitSelectionNotice]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (pendingDeletePreview) {
        event.preventDefault();
        setPendingDeletePreview(null);
        return;
      }
      if (!isSelectionMode) return;
      event.preventDefault();
      if (selectedNodeIds.length > 0) {
        clearSelectionState();
      } else {
        finishSelectionMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSelectionState, finishSelectionMode, isSelectionMode, pendingDeletePreview, selectedNodeIds.length]);

  useEffect(() => {
    if (!selectionNotice) return;
    const timeout = window.setTimeout(() => {
      setSelectionNotice((current) => (current?.id === selectionNotice.id ? null : current));
    }, 3600);
    return () => window.clearTimeout(timeout);
  }, [selectionNotice]);

  const handleRearrangeAndCenter = useCallback(() => {
    if (!renderProject || !rfInstance) return;
    setLayoutRefreshToken((n) => n + 1);
    const mainlineNodeIds = new Set(renderMainlines[renderProject.project_id] || []);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const renderedNodes = (rfInstance.getNodes?.() || []) as FlowNode[];
        const mainlineRenderedNodes = renderedNodes.filter((n) => mainlineNodeIds.has(n.id));
        if (mainlineRenderedNodes.length > 0) {
          rfInstance.fitView({ nodes: mainlineRenderedNodes, duration: 500, padding: 0.35 });
        } else {
          rfInstance.fitView({ duration: 500, padding: 0.1 });
        }
      });
    });
  }, [renderProject, rfInstance, renderMainlines]);

  const getVisibleNodesForBasePath = useCallback((basePath: string): Node[] => {
    return resolveVisibleNodesForBasePath(basePath, branches, nodes, resolvedMainlineNodeIds);
  }, [branches, nodes, resolvedMainlineNodeIds]);

  const handleManualRebranchFromMap = useCallback((nodeId: string) => {
    if (!project || !context) return;
    const anchorNode = nodes[nodeId];
    const sourceBasePath = anchorNode?.branch_id || 'mainline';
    const sourceBranch = anchorNode?.branch_id ? branches[anchorNode.branch_id] : null;
    const sourceIsMainline = sourceBasePath === 'mainline';
    const visibleNodes = getVisibleNodesForBasePath(sourceBasePath);
    let currentPair = buildQAPair(anchorNode, null);
    if (anchorNode?.role === 'assistant' && anchorNode.parent_id) {
      currentPair = buildQAPair(nodes[anchorNode.parent_id], anchorNode);
    } else if (anchorNode?.role === 'user') {
      const assistantChild = Object.values(nodes).find((n) => n.parent_id === anchorNode.node_id && n.role === 'assistant');
      currentPair = buildQAPair(anchorNode, assistantChild || null);
    }
    const historyPairs = buildQAPairsFromOrderedNodes(visibleNodes).slice(-3);
    const currentTLDR = !sourceIsMainline && sourceBranch
      ? sourceBranch.intent_summary || sourceBranch.parent_context_tldr || summarizeRecent(visibleNodes.map((n) => n.content), 160)
      : summarizeRecent(visibleNodes.map((n) => n.content), 160);
    const level = getCurrentLevel(sourceIsMainline, sourceBranch || null, branches);

    const manualSample = {
      current_tldr: currentTLDR,
      history_last_3_qa: historyPairs,
      current_node: currentPair,
      level,
      user_behaviour: 'branch',
      behaviour_source: 'manually_branch',
    } as const;
    logBranchDebug('dataset-pending', {
      source: 'manually_branch',
      from: 'context-map',
      userBehaviour: 'branch',
      level,
      nodeId,
      sourceBasePath,
    });
    const createdBranchId = createBranch(project.project_id, nodeId);
    if (createdBranchId) {
      setPendingBranchFeedback(createdBranchId, manualSample);
    }
  }, [project, context, nodes, branches, createBranch, getVisibleNodesForBasePath]);

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-400 bg-zinc-50">
        No project selected
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-50" ref={containerRef}>
      <div className="p-4 border-b border-zinc-200 bg-white flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-2 font-semibold text-zinc-800">
          <Layers size={18} />
          Context Map
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center rounded-md border border-zinc-300 overflow-hidden bg-white">
            <div className="px-2 text-zinc-500" title="History controls">
              <History size={13} />
            </div>
            <div className="h-5 w-px bg-zinc-300" />
            <button
              onClick={undoStructureChange}
              disabled={!canUndoStructure || isDeletePreviewActive}
              className={clsx(
                "p-2 transition-colors flex items-center",
                canUndoStructure && !isDeletePreviewActive ? "bg-white text-zinc-600 hover:bg-zinc-100" : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
              )}
              title="Undo last mainline/branch change"
              aria-label="Undo"
            >
              <Undo2 size={13} />
            </button>
            <button
              onClick={redoStructureChange}
              disabled={!canRedoStructure || isDeletePreviewActive}
              className={clsx(
                "p-2 transition-colors border-l border-zinc-300 flex items-center",
                canRedoStructure && !isDeletePreviewActive ? "bg-white text-zinc-600 hover:bg-zinc-100" : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
              )}
              title="Redo last mainline/branch change"
              aria-label="Redo"
            >
              <Redo2 size={13} />
            </button>
            <button
              onClick={() => project && resetStructureToNatural(project.project_id)}
              disabled={!hasNaturalResetTarget || isDeletePreviewActive}
              className={clsx(
                "p-2 transition-colors border-l border-zinc-300 flex items-center",
                hasNaturalResetTarget && !isDeletePreviewActive
                  ? "bg-white text-zinc-600 hover:bg-zinc-100"
                  : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
              )}
              title="Reset structure to natural state (as if no mainline rewrites happened)"
              aria-label="Reset to natural"
            >
              <RotateCcw size={13} />
            </button>
          </div>
          <div className="text-xs text-zinc-500 flex items-center gap-1">
            <MousePointerSquareDashed size={14} />
            <span className="hidden md:inline">
              {isSelectionMode
                ? selectionIntent === 'delete'
                  ? 'Delete mode: select nodes, preview, then confirm'
                  : 'Selection active: click add, Shift+drag box'
                : 'Click toggles node context'}
            </span>
          </div>
        </div>
      </div>
      
      <div className="flex-1 relative">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          onNodesChange={handleFlowNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(event, node) => handleNodePrimaryAction(event as React.MouseEvent, node.id)}
          nodeTypes={nodeTypes}
          onPaneClick={onPaneClick}
          onInit={setRfInstance}
          elementsSelectable={false}
          nodesDraggable={!isSelectionMode && !isDeletePreviewActive}
          selectionMode={SelectionMode.Partial}
          selectionOnDrag={false}
          panOnScroll={false}
          fitView
          attributionPosition="bottom-right"
        >
          <Background color="#e4e4e7" gap={16} />
          <Controls showInteractive={false} />
        </ReactFlow>

        {/* Floating View Controls */}
        <div className="absolute top-4 right-4 max-w-[calc(100%-2rem)] overflow-hidden bg-white/92 backdrop-blur-xl border border-zinc-200 rounded-[1.35rem] shadow-[0_18px_45px_rgba(15,23,42,0.14)] p-2 flex items-center justify-end gap-1.5 z-20">
          <button
            onClick={handleToggleSelectionMode}
            className={clsx(
              "min-w-0 flex-1 overflow-hidden text-xs px-2.5 py-2 rounded-xl border transition-all flex items-center justify-center gap-1.5",
              isSelectionMode && selectionIntent === 'batch'
                ? `${SELECTION_ACTIVE_SURFACE} shadow-[0_10px_20px_rgba(39,39,42,0.18)]`
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
            )}
            title={isSelectionMode ? 'Finish node selection mode' : 'Start selecting nodes for batch actions'}
          >
            {isSelectionMode && selectionIntent === 'batch' ? <X size={13} className="!text-white" /> : <Sparkles size={13} className="text-inherit" />}
            <span className={clsx("truncate", isSelectionMode && selectionIntent === 'batch' && "!text-white")}>
              {isSelectionMode && selectionIntent === 'batch' ? 'Finish' : 'Selection'}
            </span>
          </button>
          <button
            onClick={handleRearrangeAndCenter}
            className="min-w-0 flex-1 overflow-hidden text-xs text-zinc-600 px-2.5 py-2 rounded-xl border border-zinc-300 bg-white hover:bg-zinc-100 transition-colors flex items-center justify-center gap-1"
            title="Rearrange and center mainline"
          >
            <WandSparkles size={13} />
            <span className="truncate">Rearrange</span>
          </button>
          <button
            onClick={handleDeleteButton}
            className={clsx(
              "min-w-0 shrink-0 text-xs px-2.5 py-2 rounded-xl border transition-colors flex items-center justify-center gap-1",
              isSelectionMode && selectionIntent === 'delete'
                ? `${DELETE_ACTIVE_SURFACE} shadow-[0_10px_20px_rgba(225,29,72,0.18)]`
                : "text-rose-700 border-rose-200 bg-rose-50 hover:bg-rose-100"
            )}
            title={isSelectionMode && selectionIntent === 'delete' ? 'Preview and confirm delete for selected nodes' : 'Start delete selection mode'}
          >
            <Trash2 size={13} />
            <span className="truncate">{isSelectionMode && selectionIntent === 'delete' ? 'Delete' : 'Delete'}</span>
          </button>
          {projectNodeCount > 0 && flowNodes.length === 0 && (
            <button
              onClick={() => {
                setLayoutRefreshToken((n) => n + 1);
                handleRearrangeAndCenter();
              }}
              className="text-xs text-amber-700 px-2 py-1 rounded-md border border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors"
              title="Recover map rendering"
            >
              Recover Map
            </button>
          )}
        </div>

        {pendingDeletePreview && (
          <div
            className="absolute left-4 top-20 z-20 w-[min(24rem,calc(100%-2rem))] rounded-[1.2rem] border border-rose-200 bg-white/95 p-3 shadow-[0_18px_40px_rgba(15,23,42,0.16)] backdrop-blur-xl"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700">
                  <Trash2 size={12} />
                  Delete Preview
                </div>
                <h3 className="text-sm font-semibold text-slate-950">Previewing the post-delete context map</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {pendingDeletePreview.summary}
                </p>
              </div>
              <button
                onClick={() => setPendingDeletePreview(null)}
                className="rounded-full border border-zinc-200 p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                aria-label="Close delete preview"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs leading-5 text-slate-600">
              {pendingDeletePreview.requiresPlaceholder
                ? 'Placeholder nodes are highlighted in amber. Rearrange now only affects this previewed structure.'
                : 'This preview is rendered from the candidate structure only. Cancel keeps the current map unchanged.'}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => setPendingDeletePreview(null)}
                className="rounded-full border border-zinc-300 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="inline-flex items-center gap-2 rounded-full border border-rose-600 bg-rose-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700"
              >
                <Trash2 size={15} />
                Confirm delete
              </button>
            </div>
          </div>
        )}

        {selectionNotice && (
          <div
            className={clsx(
              "absolute top-20 right-4 z-20",
              selectionNotice.tone === 'success'
                ? "w-[min(15rem,calc(100%-2rem))]"
                : "w-[min(18rem,calc(100%-2rem))]"
            )}
          >
            <div
              className={clsx(
                "rounded-[1.2rem] border bg-white/94 backdrop-blur-xl",
                selectionNotice.tone === 'success'
                  ? "p-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.1)]"
                  : "p-3 shadow-[0_16px_40px_rgba(15,23,42,0.14)]",
                selectionNotice.tone === 'info' && "border-zinc-200 text-slate-900",
                selectionNotice.tone === 'success' && "border-emerald-200 text-emerald-950",
                selectionNotice.tone === 'warning' && "border-amber-200 text-amber-950",
                selectionNotice.tone === 'error' && "border-rose-200 text-rose-950"
              )}
              role="status"
              aria-live="polite"
            >
              <div className={clsx("flex items-start", selectionNotice.tone === 'success' ? "gap-2.5" : "gap-3")}>
                <div
                  className={clsx(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border",
                    selectionNotice.tone === 'info' && "border-zinc-200 bg-zinc-100 text-zinc-700",
                    selectionNotice.tone === 'success' && "border-emerald-200 bg-emerald-50 text-emerald-700",
                    selectionNotice.tone === 'warning' && "border-amber-200 bg-amber-50 text-amber-700",
                    selectionNotice.tone === 'error' && "border-rose-200 bg-rose-50 text-rose-700"
                  )}
                >
                  {selectionNotice.tone === 'info' && <Info size={16} />}
                  {selectionNotice.tone === 'success' && <CheckCircle2 size={15} />}
                  {selectionNotice.tone === 'warning' && <TriangleAlert size={16} />}
                  {selectionNotice.tone === 'error' && <CircleAlert size={16} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      {selectionNotice.tone !== 'success' && (
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Context Map</p>
                      )}
                      <h3 className={clsx(selectionNotice.tone === 'success' ? "text-[13px] font-semibold" : "mt-1 text-sm font-semibold")}>
                        {selectionNotice.title}
                      </h3>
                    </div>
                    <button
                      onClick={() => emitSelectionNotice(null)}
                      className="rounded-full p-1 text-slate-400 transition-colors hover:bg-black/5 hover:text-slate-700"
                      aria-label="Dismiss notice"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <p className={clsx(selectionNotice.tone === 'success' ? "mt-1 text-[12px] leading-5 text-slate-600" : "mt-2 text-sm leading-5")}>
                    {selectionNotice.message}
                  </p>
                  {selectionNotice.details && (
                    <button
                      onClick={() => setIsSelectionNoticeExpanded((prev) => !prev)}
                      className={clsx(
                        "text-xs font-medium text-slate-500 transition-colors hover:text-slate-900",
                        selectionNotice.tone === 'success' ? "mt-1.5" : "mt-2"
                      )}
                    >
                      {isSelectionNoticeExpanded ? 'Hide details' : 'View details'}
                    </button>
                  )}
                  {isSelectionNoticeExpanded && selectionNotice.details && (
                    <div className="mt-2 rounded-2xl border border-black/5 bg-slate-950 px-3 py-2 text-xs leading-5 text-slate-100 whitespace-pre-line">
                      {selectionNotice.details}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Floating Batch Action Bar */}
        {isSelectionMode && selectionIntent === 'batch' && selectedNodeIds.length > 0 && (
          <div
            className="absolute top-20 right-4 z-20 max-w-[calc(100%-2rem)] rounded-[1.1rem] border border-zinc-200 bg-white/96 p-2 text-slate-900 shadow-[0_10px_26px_rgba(15,23,42,0.1)] backdrop-blur-xl"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <div className={clsx("mr-1 flex items-center gap-1.5 rounded-full px-2.5 py-1.5", SELECTION_ACTIVE_SURFACE)}>
                <span className="text-xs font-semibold leading-none">
                  {selectedNodeIds.length}
                </span>
                <span className="text-[11px] font-medium leading-none">
                  selected
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleApplySelection('include');
                }}
                disabled={isBatchBusy || selectedNodeIds.length === 0}
                className={clsx(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
                  isBatchBusy || selectedNodeIds.length === 0
                    ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                )}
              >
                + Include
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleApplySelection('exclude');
                }}
                disabled={isBatchBusy || selectedNodeIds.length === 0}
                className={clsx(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
                  isBatchBusy || selectedNodeIds.length === 0
                    ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                )}
              >
                - Exclude
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleInvertSelection();
                }}
                disabled={isBatchBusy || selectedNodeIds.length === 0}
                className={clsx(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
                  isBatchBusy || selectedNodeIds.length === 0
                    ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                )}
              >
                <ArrowRightLeft size={14} />
                Invert
              </button>
              <div className="mx-1 h-6 w-px bg-slate-200" />
              <select
                value={pendingPatternType}
                onChange={(e) => setPendingPatternType(e.target.value as PatternType)}
                disabled={isBatchBusy}
                aria-label="Pattern type"
                className="h-8 rounded-full border border-slate-300 bg-white px-2.5 text-[11px] text-slate-700 outline-none"
              >
                {PATTERN_TYPE_ORDER.map((type) => (
                  <option key={type} value={type}>
                    {PATTERN_TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleExtractPatternFromSelection();
                }}
                disabled={isBatchBusy || selectedNodeIds.length === 0}
                className={clsx(
                  "inline-flex h-8 items-center justify-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
                  isBatchBusy || selectedNodeIds.length === 0
                    ? "border-slate-200 bg-slate-200 text-slate-500 cursor-not-allowed"
                    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                )}
              >
                <Sparkles size={14} className="text-inherit" />
                <span>{isBatchBusy ? 'Extracting...' : 'Extract'}</span>
              </button>
            </div>
          </div>
        )}

        {isSelectionMode && selectionIntent === 'delete' && selectedNodeIds.length > 0 && (
          <div
            className="absolute top-20 right-4 z-20 max-w-[calc(100%-2rem)] rounded-[1.1rem] border border-rose-200 bg-white/96 p-2 text-slate-900 shadow-[0_10px_26px_rgba(225,29,72,0.1)] backdrop-blur-xl"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <div className={clsx("mr-1 flex items-center gap-1.5 rounded-full px-2.5 py-1.5", DELETE_ACTIVE_SURFACE)}>
                <span className="text-xs font-semibold leading-none">
                  {selectedNodeIds.length}
                </span>
                <span className="text-[11px] font-medium leading-none">
                  marked
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteButton();
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 text-[11px] font-medium text-rose-700 transition-colors hover:bg-rose-100"
              >
                <Trash2 size={14} />
                Preview delete
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearSelectionState();
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-2.5 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Bottom Layout Mode Bar */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/55 backdrop-blur-xl border border-white/70 rounded-full shadow-[0_10px_30px_rgba(0,0,0,0.16)] p-1.5 flex items-center gap-1 z-20">
          <button
              onClick={() => setLayoutMode('tree')}
              className={clsx(
                "text-xs px-3 py-1.5 rounded-full transition-colors",
                layoutMode === 'tree'
                  ? "bg-zinc-200/85 text-zinc-900 shadow-sm"
                  : "bg-transparent text-zinc-700 hover:bg-white/50"
              )}
            >
              Tree
            </button>
          <button
              onClick={() => setLayoutMode('mindmap')}
              className={clsx(
                "text-xs px-3 py-1.5 rounded-full transition-colors",
                layoutMode === 'mindmap'
                  ? "bg-zinc-200/85 text-zinc-900 shadow-sm"
                  : "bg-transparent text-zinc-700 hover:bg-white/50"
              )}
            >
              Mindmap
            </button>
          <button
              onClick={() => setLayoutMode('timeline')}
              className={clsx(
                "text-xs px-3 py-1.5 rounded-full transition-colors",
                layoutMode === 'timeline'
                  ? "bg-zinc-200/85 text-zinc-900 shadow-sm"
                  : "bg-transparent text-zinc-700 hover:bg-white/50"
              )}
            >
              Timeline
          </button>
        </div>
        
        {/* Context Menu */}
        {contextMenu && (
          <div 
            className="fixed bg-white border border-zinc-200 shadow-lg rounded-md py-1 z-50 min-w-[180px]"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            <button
              className="w-full text-left px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
              onClick={() => {
                jumpToNode(project.project_id, contextMenu.nodeId);
                setContextMenu(null);
              }}
            >
              Locate in Chat
            </button>
            <button
              className="w-full text-left px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
              onClick={() => {
                handleManualRebranchFromMap(contextMenu.nodeId);
                setContextMenu(null);
              }}
            >
              Re-Branch from Here
            </button>
            <div className="h-px bg-zinc-200 my-1" />
            <button
              className="w-full text-left px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
              onClick={() => {
                setSelectedStartId(contextMenu.nodeId);
                setContextMenu(null);
              }}
            >
              Set as Mainline Start
            </button>
            <button
              className="w-full text-left px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
              onClick={() => {
                if (selectedStartId) {
                  setMainlineEndpoints(project.project_id, selectedStartId, contextMenu.nodeId);
                  setSelectedStartId(null);
                } else {
                  emitSelectionNotice({
                    id: `mainline-start-required-${Date.now()}`,
                    tone: 'info',
                    title: 'Choose a start node first',
                    message: 'Set a Mainline Start node before choosing the Mainline End node.',
                  });
                }
                setContextMenu(null);
              }}
            >
              Set as Mainline End
            </button>
          </div>
        )}

      </div>

      {/* Legend */}
      <div className="p-3 bg-white border-t border-zinc-200 text-xs flex flex-wrap gap-3 text-zinc-600">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 border-2 border-indigo-500 bg-indigo-50 rounded-sm"></div>
          Active Path
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 border-2 border-emerald-500 bg-emerald-50 rounded-sm"></div>
          Included
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 border-2 border-dashed border-red-300 bg-red-50 rounded-sm"></div>
          Excluded
        </div>
      </div>
    </div>
  );
}
