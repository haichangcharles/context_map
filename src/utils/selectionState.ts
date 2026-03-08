import type { NodeChange } from '@xyflow/react';

type SelectNodeChange = Extract<NodeChange, { type: 'select' }>;

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
