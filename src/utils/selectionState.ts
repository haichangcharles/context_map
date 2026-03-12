import type { NodeChange } from '@xyflow/react';

type SelectNodeChange = Extract<NodeChange, { type: 'select' }>;
type SelectionRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};
type FlowNodeBounds = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export const reconcileSelectedNodeIds = (
  selectedNodeIds: string[],
  changes: SelectNodeChange[]
): string[] => {
  const next = new Set(selectedNodeIds);

  changes.forEach((change) => {
    if (change.selected) {
      next.add(change.id);
      return;
    }
    next.delete(change.id);
  });

  return Array.from(next);
};

export const resolveNodeSelectionClick = (
  selectedNodeIds: string[],
  nodeId: string,
  _additive: boolean
): string[] => {
  const next = new Set(selectedNodeIds);
  if (next.has(nodeId)) {
    next.delete(nodeId);
  } else {
    next.add(nodeId);
  }
  return Array.from(next);
};

export const getNodeIdsIntersectingSelectionRect = (
  nodes: FlowNodeBounds[],
  rect: SelectionRect
): string[] => {
  return nodes
    .filter((node) => {
      const nodeLeft = node.x;
      const nodeRight = node.x + node.width;
      const nodeTop = node.y;
      const nodeBottom = node.y + node.height;

      return !(
        nodeRight < rect.left ||
        nodeLeft > rect.right ||
        nodeBottom < rect.top ||
        nodeTop > rect.bottom
      );
    })
    .map((node) => node.id);
};
