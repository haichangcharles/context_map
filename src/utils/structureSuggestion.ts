export type StructurePrimaryAction = 'continue' | 'branch' | 'return_parent';
export type StructureAssetAction =
  | 'none'
  | 'extract_reasoning'
  | 'extract_task_sop';

export type StructureSuggestionDecision = {
  primaryAction: StructurePrimaryAction;
  assetAction: StructureAssetAction;
  confidence: number;
  reason: string;
  assetReason: string;
  showSuggestion: boolean;
};

const DEFAULT_DECISION: StructureSuggestionDecision = {
  primaryAction: 'continue',
  assetAction: 'none',
  confidence: 0,
  reason: '',
  assetReason: '',
  showSuggestion: false,
};

const clampConfidence = (value: unknown): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const parseJsonFromText = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
    if (fenced) return JSON.parse(fenced);
    const objectLike = text.match(/\{[\s\S]*\}/)?.[0];
    if (objectLike) return JSON.parse(objectLike);
    return null;
  }
};

const isPrimaryAction = (value: unknown): value is StructurePrimaryAction =>
  value === 'continue' || value === 'branch' || value === 'return_parent';

const isAssetAction = (value: unknown): value is StructureAssetAction =>
  value === 'none' ||
  value === 'extract_reasoning' ||
  value === 'extract_task_sop';

export const parseStructureSuggestionDecision = (raw: string): StructureSuggestionDecision => {
  const parsed = parseJsonFromText(raw);
  if (!parsed || typeof parsed !== 'object') return DEFAULT_DECISION;

  const payload = parsed as Record<string, unknown>;
  const primaryAction = isPrimaryAction(payload.primary_action) ? payload.primary_action : 'continue';
  const assetAction = isAssetAction(payload.asset_action) ? payload.asset_action : 'none';
  const confidence = clampConfidence(payload.confidence);
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  const assetReason = typeof payload.asset_reason === 'string' ? payload.asset_reason.trim() : '';
  const showSuggestion = payload.show_suggestion === true;

  return {
    primaryAction,
    assetAction,
    confidence,
    reason,
    assetReason,
    showSuggestion,
  };
};
