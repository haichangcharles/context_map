export type ContextMapNodeVisualState = 'active' | 'included' | 'visible' | 'excluded';

type ResolveContextMapNodeVisualStateInput = {
  isActive: boolean;
  isIncluded: boolean;
  isExcluded: boolean;
};

type CountableContextMapNodeState = {
  id: string;
  state: ContextMapNodeVisualState;
};

type BuildContextMapScopeSummaryInput = {
  basePath: 'mainline' | string;
  branchLabel?: string | null;
  activeCount: number;
  includedCount: number;
  visibleCount: number;
  excludedCount: number;
};

export const resolveContextMapNodeVisualState = ({
  isActive,
  isIncluded,
  isExcluded,
}: ResolveContextMapNodeVisualStateInput): ContextMapNodeVisualState => {
  if (isExcluded) return 'excluded';
  if (isIncluded) return 'included';
  if (isActive) return 'active';
  return 'visible';
};

export const countContextMapNodeVisualStates = (
  nodes: CountableContextMapNodeState[]
): Record<ContextMapNodeVisualState, number> => {
  return nodes.reduce<Record<ContextMapNodeVisualState, number>>(
    (acc, node) => {
      acc[node.state] += 1;
      return acc;
    },
    {
      active: 0,
      included: 0,
      visible: 0,
      excluded: 0,
    }
  );
};

export const buildContextMapScopeSummary = ({
  basePath,
  branchLabel,
  activeCount,
  includedCount,
  visibleCount,
  excludedCount,
}: BuildContextMapScopeSummaryInput): { label: string; helperText: string } => {
  const label = basePath === 'mainline' ? 'Mainline view' : (branchLabel?.trim() || 'Branch view');

  if (basePath === 'mainline') {
    if (visibleCount > 0) {
      return {
        label,
        helperText:
          'Blue nodes are in the current context. White nodes and branch cards can stay visible for structure, so branches stay visible even while you are on mainline.',
      };
    }

    if (includedCount > 0 || excludedCount > 0) {
      return {
        label,
        helperText: 'You are on mainline. Green nodes were explicitly included, and red dashed nodes were explicitly excluded from the current context.',
      };
    }

    return {
      label,
      helperText: activeCount > 0 ? 'You are on mainline. Blue nodes are the current context.' : 'You are on mainline.',
    };
  }

  if (visibleCount > 0) {
    return {
      label,
      helperText: 'This branch is the current context. White nodes remain visible for structure outside the current context.',
    };
  }

  if (includedCount > 0 || excludedCount > 0) {
    return {
      label,
      helperText: 'This branch is the current context. Green nodes were explicitly included, and red dashed nodes were explicitly excluded.',
    };
  }

  return {
    label,
    helperText: 'This branch is the current context.',
  };
};
