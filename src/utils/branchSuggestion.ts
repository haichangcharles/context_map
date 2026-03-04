export type BranchSuggestionDecision = {
  shouldBranch: boolean;
  confidence: number;
  reason: string;
};

const DEFAULT_DECISION: BranchSuggestionDecision = {
  shouldBranch: false,
  confidence: 0,
  reason: '',
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

export const parseBranchSuggestionDecision = (raw: string): BranchSuggestionDecision => {
  const parsed = parseJsonFromText(raw);
  if (!parsed || typeof parsed !== 'object') return DEFAULT_DECISION;

  const payload = parsed as Record<string, unknown>;
  const shouldBranch = payload.should_branch === true;
  const confidence = clampConfidence(payload.confidence);
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';

  if (!shouldBranch) {
    return {
      shouldBranch: false,
      confidence,
      reason,
    };
  }

  return {
    shouldBranch: confidence >= 0.5,
    confidence,
    reason,
  };
};

export const shouldOfferBranchSuggestion = (decision: BranchSuggestionDecision): boolean =>
  decision.shouldBranch;
