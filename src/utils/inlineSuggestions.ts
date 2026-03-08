export type InlineBranchSuggestionState = {
  reason: string;
  assetAction?: 'none' | 'extract_reasoning' | 'extract_task_sop';
  assetReason?: string;
};

export type InlineStructureSuggestionState = {
  primaryAction: 'return_parent' | 'continue' | 'branch';
  assetAction: 'none' | 'extract_reasoning' | 'extract_task_sop';
  reason: string;
  assetReason: string;
};

export type InlineSuggestionItem =
  | {
      kind: 'branch';
      title: string;
      message: string;
      accent: 'amber';
      cta: 'Accept';
    }
  | {
      kind: 'branch_extract' | 'structure_extract';
      title: string;
      message: string;
      accent: 'indigo';
      cta: 'Extract SOP' | 'Extract Reasoning';
    }
  | {
      kind: 'return_parent';
      title: string;
      message: string;
      accent: 'indigo';
      cta: 'Return';
    };

export const buildInlineSuggestions = (
  input: {
    targetNodeId: string;
    branchSuggestion: InlineBranchSuggestionState | null;
    structureSuggestion: InlineStructureSuggestionState | null;
  },
  nodeId: string
): InlineSuggestionItem[] => {
  if (input.targetNodeId !== nodeId) return [];

  const items: InlineSuggestionItem[] = [];

  if (input.branchSuggestion) {
    items.push({
      kind: 'branch',
      title: 'Suggest opening a new branch?',
      message: input.branchSuggestion.reason,
      accent: 'amber',
      cta: 'Accept',
    });

    if (input.branchSuggestion.assetAction && input.branchSuggestion.assetAction !== 'none' && input.branchSuggestion.assetReason) {
      items.push({
        kind: 'branch_extract',
        title:
          input.branchSuggestion.assetAction === 'extract_reasoning'
            ? 'Extract reasoning pattern'
            : 'Extract task SOP',
        message: input.branchSuggestion.assetReason,
        accent: 'indigo',
        cta: input.branchSuggestion.assetAction === 'extract_reasoning' ? 'Extract Reasoning' : 'Extract SOP',
      });
    }
  }

  if (input.structureSuggestion?.primaryAction === 'return_parent' && input.structureSuggestion.reason) {
    items.push({
      kind: 'return_parent',
      title: 'Return to parent?',
      message: input.structureSuggestion.reason,
      accent: 'indigo',
      cta: 'Return',
    });
  }

  if (input.structureSuggestion?.assetAction !== 'none' && input.structureSuggestion?.assetReason) {
    items.push({
      kind: 'structure_extract',
      title:
        input.structureSuggestion.assetAction === 'extract_reasoning'
          ? 'Extract reasoning pattern'
          : 'Extract task SOP',
      message: input.structureSuggestion.assetReason,
      accent: 'indigo',
      cta: input.structureSuggestion.assetAction === 'extract_reasoning' ? 'Extract Reasoning' : 'Extract SOP',
    });
  }

  return items;
};

export const clampInlineSuggestionIndex = (index: number, itemCount: number) => {
  if (itemCount <= 0) return 0;
  if (index < 0) return 0;
  if (index >= itemCount) return itemCount - 1;
  return index;
};
