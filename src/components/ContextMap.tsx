import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useAppStore } from '../store';
import { ReactFlow, Background, Controls, Node as FlowNode, Edge, Position, MarkerType, useNodesState, useEdgesState, Handle, ReactFlowInstance, SelectionMode } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Node, Branch } from '../types';
import clsx from 'clsx';
import { Layers, Eye, EyeOff, GitBranch, MousePointerSquareDashed, WandSparkles, Undo2, Redo2, RotateCcw, Maximize2, History } from 'lucide-react';
import dagre from 'dagre';

// Custom Node Component
const CustomNode = ({ data }: { data: any }) => {
  const isExcluded = data.isExcluded;
  const isIncluded = data.isIncluded;
  const isActive = data.isActive; // In the current base path
  const isSelectedStart = data.isSelectedStart;
  
  return (
    <div 
      className={clsx(
        "px-3 py-2 shadow-md rounded-md border-2 text-xs w-48 transition-all cursor-pointer relative",
        isActive ? "border-indigo-500 bg-indigo-50" : "border-zinc-200 bg-white",
        isExcluded && "opacity-50 border-dashed border-red-300 bg-red-50",
        isIncluded && !isActive && "border-emerald-500 bg-emerald-50",
        isSelectedStart && "ring-4 ring-orange-400 ring-offset-2"
      )}
      onClick={data.onToggle}
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
      {data.branchId && (
        <div className="mt-1 flex items-center gap-1 text-[9px] text-indigo-600 bg-indigo-100 px-1 py-0.5 rounded-sm w-fit">
          <GitBranch size={10} />
          Branch
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
    toggleNodeInclusion, setMainlineEndpoints, createBranch, jumpToNode, batchToggleInclusion,
    pastStructureSnapshots, futureStructureSnapshots, undoStructureChange, redoStructureChange, resetStructureToNatural, naturalMainlines
  } = useAppStore();
  
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState([]);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('tree');
  const [layoutRefreshToken, setLayoutRefreshToken] = useState(0);
  
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, nodeId: string } | null>(null);
  const [selectedStartId, setSelectedStartId] = useState<string | null>(null);
  
  const [rfInstance, setRfInstance] = useState<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previousLayoutModeRef = useRef<LayoutMode>('tree');
  const previousLayoutRefreshTokenRef = useRef(0);
  const previousStructureSignatureRef = useRef<string>('');

  const project = activeProjectId ? projects[activeProjectId] : null;
  const context = project ? contexts[project.active_context_id] : null;

  const onPaneClick = useCallback(() => setContextMenu(null), []);

  const resolvedMainlineNodeIds = useMemo(() => {
    if (!project) return [] as string[];
    const rawMainline = mainlines[project.project_id] || [];
    const validMainline = rawMainline.filter((id) => nodes[id]?.project_id === project.project_id);
    if (validMainline.length > 0) return validMainline;
    return Object.values(nodes)
      .filter((n) => n.project_id === project.project_id && n.branch_id === null)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((n) => n.node_id);
  }, [project, mainlines, nodes]);

  const activeNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!project || !context) return ids;
    const isMainline = context.base_path === 'mainline';
    const currentBranch = !isMainline ? branches[context.base_path] : null;

    if (isMainline) {
      resolvedMainlineNodeIds.forEach(id => ids.add(id));
    } else if (currentBranch) {
      const branchChainIds = getBranchChainIds(currentBranch.branch_id, branches);
      const rootBranchId = branchChainIds[0];
      const rootBranch = rootBranchId ? branches[rootBranchId] : null;
      const anchorIndex = rootBranch ? resolvedMainlineNodeIds.indexOf(rootBranch.anchor_node_id) : -1;
      if (anchorIndex !== -1) {
        resolvedMainlineNodeIds.slice(0, anchorIndex + 1).forEach(id => ids.add(id));
      } else {
        resolvedMainlineNodeIds.forEach(id => ids.add(id));
      }
      branchChainIds.forEach((branchId) => {
        Object.values(nodes)
          .filter((n) => n.branch_id === branchId)
          .forEach((n) => ids.add(n.node_id));
      });
    }
    return ids;
  }, [project, context, resolvedMainlineNodeIds, branches, nodes]);

  useEffect(() => {
    if (!project || !context) return;

    const mainlineNodeIds = resolvedMainlineNodeIds;
    const modeChanged = previousLayoutModeRef.current !== layoutMode;
    const relayoutRequested = previousLayoutRefreshTokenRef.current !== layoutRefreshToken;
    previousLayoutModeRef.current = layoutMode;
    previousLayoutRefreshTokenRef.current = layoutRefreshToken;

    const initialNodes: FlowNode[] = [];
    const initialEdges: Edge[] = [];

    const projectBranches = Object.values(branches).filter((branch) => branch.project_id === project.project_id);
    const projectBranchIds = new Set(projectBranches.map((branch) => branch.branch_id));
    const projectNodes = Object.values(nodes).filter((n) => n.project_id === project.project_id);

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
        projectId: project.project_id,
        orphanBranchCount: orphanNodesByBranchId.size,
      });
    }

    const syntheticOrphanBranches: Branch[] = Array.from(orphanNodesByBranchId.entries()).map(([branchId, orphanNodes]) => {
      const sorted = [...orphanNodes].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const firstNode = sorted[0];
      const anchorNodeId =
        (firstNode.parent_id && nodes[firstNode.parent_id]?.project_id === project.project_id
          ? firstNode.parent_id
          : null) ||
        mainlineNodeIds[0] ||
        firstNode.node_id;

      return {
        branch_id: branchId,
        project_id: project.project_id,
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
      .filter((group) => group.branchNodes.length > 0 && !!nodes[group.branch.anchor_node_id])
      .sort((a, b) => {
        const aIndex = mainlineNodeIds.indexOf(a.branch.anchor_node_id);
        const bIndex = mainlineNodeIds.indexOf(b.branch.anchor_node_id);
        if (aIndex !== bIndex) return aIndex - bIndex;
        return new Date(a.branchNodes[0].timestamp).getTime() - new Date(b.branchNodes[0].timestamp).getTime();
      });

    const structureSignature = JSON.stringify({
      mainline: mainlineNodeIds,
      projectNodes: projectNodes
        .map((n) => `${n.node_id}:${n.parent_id ?? 'null'}:${n.branch_id ?? 'mainline'}`)
        .sort(),
      branchGroups: projectBranchGroups
        .map((g) => `${g.branch.branch_id}:${g.branch.anchor_node_id}:${g.branchNodes.map((n) => n.node_id).join(',')}`)
        .sort(),
    });
    const structureChanged = previousStructureSignatureRef.current !== structureSignature;
    previousStructureSignatureRef.current = structureSignature;

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
      const node = nodes[nodeId];
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
          isExcluded: context.excluded_nodes.includes(nodeId),
          isIncluded: context.included_nodes.includes(nodeId),
          isSelectedStart: nodeId === selectedStartId,
          onToggle: () => toggleNodeInclusion(project.project_id, nodeId),
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

    // Place branch nodes
    projectBranchGroups.forEach(({ branch, branchNodes }) => {
      const side = branchSideById.get(branch.branch_id) || 'right';
      branchNodes.forEach((node, index) => {
        initialNodes.push({
          id: node.node_id,
          type: 'custom',
          position: { x: 0, y: 0 },
          data: {
            role: node.role,
            content: node.content,
            branchId: node.branch_id,
            isActive: activeNodeIds.has(node.node_id),
            isExcluded: context.excluded_nodes.includes(node.node_id),
            isIncluded: context.included_nodes.includes(node.node_id),
            isSelectedStart: node.node_id === selectedStartId,
            onToggle: () => toggleNodeInclusion(project.project_id, node.node_id),
            onContextMenu: (e: React.MouseEvent) => handleContextMenu(e, node.node_id),
          },
        });

        if (index === 0) {
          // Connect to anchor
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
        } else {
          // Connect to previous branch node
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

    const { nodes: dagreNodes, edges: layoutedEdges } = getLayoutedElements(initialNodes, initialEdges, 'TB');
    const structuredNodes =
      layoutMode === 'tree'
        ? dagreNodes
        : getStructuredPositions(dagreNodes, mainlineNodeIds, projectBranchGroups, branchSideById, layoutMode);

    setFlowNodes((prevNodes) => {
      const prevNodeById = new Map(prevNodes.map((n) => [n.id, n]));
      return structuredNodes.map((node) => {
        const prev = prevNodeById.get(node.id);
        const keepTreePosition = layoutMode === 'tree' && !modeChanged && !relayoutRequested && !structureChanged;
        return {
          ...node,
          position: keepTreePosition && prev ? prev.position : node.position,
          selected: prev ? !!prev.selected : false,
        };
      });
    });
    setFlowEdges(layoutedEdges);

    if (structureChanged && rfInstance) {
      window.requestAnimationFrame(() => {
        rfInstance.fitView({ duration: 300, padding: 0.15 });
      });
    }

  }, [nodes, branches, mainlines, contexts, activeProjectId, selectedStartId, activeNodeIds, project, context, toggleNodeInclusion, setFlowNodes, setFlowEdges, layoutMode, layoutRefreshToken, resolvedMainlineNodeIds, rfInstance]);

  // Auto fit view on nodes change
  useEffect(() => {
    if (rfInstance && flowNodes.length > 0) {
      window.requestAnimationFrame(() => {
        rfInstance.fitView({ duration: 500, padding: 0.1 });
      });
    }
  }, [flowNodes.length, rfInstance]); // Only trigger when node count changes

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

  const selectedFlowNodes = flowNodes.filter(n => n.selected);
  const canUndoStructure = pastStructureSnapshots.length > 0;
  const canRedoStructure = futureStructureSnapshots.length > 0;
  const hasNaturalResetTarget = !!project && ((mainlines[project.project_id] || []).join('|') !== ((naturalMainlines[project.project_id] || []).join('|')));

  const handleBatchToggle = () => {
    if (!project || !context) return;

    const selectedIds = selectedFlowNodes.map((n) => n.id);
    const includedCount = selectedFlowNodes.reduce((count, n) => {
      const isActive = activeNodeIds.has(n.id);
      const isExcluded = context.excluded_nodes.includes(n.id);
      const isIncluded = context.included_nodes.includes(n.id);
      const isEffectivelyIncluded = (isActive && !isExcluded) || (!isActive && isIncluded);
      return count + (isEffectivelyIncluded ? 1 : 0);
    }, 0);

    // Majority rule: if majority is included, set all to exclude; otherwise set all to include.
    const action = includedCount > selectedFlowNodes.length / 2 ? 'exclude' : 'include';
    batchToggleInclusion(project.project_id, selectedIds, action);

    setFlowNodes(nds => nds.map(n => ({ ...n, selected: false })));
  };

  const handleRearrangeAndCenter = useCallback(() => {
    if (!project || !rfInstance) return;
    setLayoutRefreshToken((n) => n + 1);
    const mainlineNodeIds = new Set(mainlines[project.project_id] || []);
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
  }, [project, rfInstance, mainlines]);

  const handleFitAll = useCallback(() => {
    if (!rfInstance) return;
    window.requestAnimationFrame(() => {
      rfInstance.fitView({ duration: 400, padding: 0.1 });
    });
  }, [rfInstance]);

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
              disabled={!canUndoStructure}
              className={clsx(
                "p-2 transition-colors flex items-center",
                canUndoStructure ? "bg-white text-zinc-600 hover:bg-zinc-100" : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
              )}
              title="Undo last mainline/branch change"
              aria-label="Undo"
            >
              <Undo2 size={13} />
            </button>
            <button
              onClick={redoStructureChange}
              disabled={!canRedoStructure}
              className={clsx(
                "p-2 transition-colors border-l border-zinc-300 flex items-center",
                canRedoStructure ? "bg-white text-zinc-600 hover:bg-zinc-100" : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
              )}
              title="Redo last mainline/branch change"
              aria-label="Redo"
            >
              <Redo2 size={13} />
            </button>
            <button
              onClick={() => project && resetStructureToNatural(project.project_id)}
              disabled={!hasNaturalResetTarget}
              className={clsx(
                "p-2 transition-colors border-l border-zinc-300 flex items-center",
                hasNaturalResetTarget
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
            <span className="hidden md:inline">Shift+Drag to box select</span>
          </div>
        </div>
      </div>
      
      <div className="flex-1 relative">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onPaneClick={onPaneClick}
          onInit={setRfInstance}
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
        <div className="absolute top-4 right-4 bg-white/95 backdrop-blur border border-zinc-200 rounded-xl shadow-md p-2 flex items-center gap-2 z-20">
          <button
            onClick={handleRearrangeAndCenter}
            className="text-xs text-zinc-600 px-2 py-1 rounded-md border border-zinc-300 bg-white hover:bg-zinc-100 transition-colors flex items-center gap-1"
            title="Rearrange and center mainline"
          >
            <WandSparkles size={13} />
            Rearrange
          </button>
          <button
            onClick={handleFitAll}
            className="text-xs text-zinc-600 px-2 py-1 rounded-md border border-zinc-300 bg-white hover:bg-zinc-100 transition-colors flex items-center gap-1"
            title="Fit entire graph"
          >
            <Maximize2 size={13} />
            Fit
          </button>
        </div>

        {/* Floating Batch Action Bar */}
        {selectedFlowNodes.length > 0 && (
          <div
            className="absolute top-4 left-1/2 -translate-x-1/2 bg-zinc-900 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-4 z-20"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-sm font-medium">{selectedFlowNodes.length} selected</span>
            <div className="h-4 w-px bg-zinc-700" />
            <button 
              onClick={(e) => {
                e.stopPropagation();
                handleBatchToggle();
              }}
              className="text-sm hover:text-indigo-400 transition-colors flex items-center gap-1"
            >
              Toggle Context
            </button>
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
                createBranch(project.project_id, contextMenu.nodeId);
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
                  alert('Please select a Mainline Start node first.');
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
