import { Node } from '../types';

export type BehaviourSource = 'manually_branch' | 'ignore_branch' | 'reject_branch' | 'accept_branch';
export type UserBehaviour = 'branch' | 'same_thread';

export type QAPair = {
  user: string;
  assistant: string;
};

export type BranchFeedbackSample = {
  current_tldr: string;
  history_last_3_qa: QAPair[];
  current_node: QAPair;
  level: number;
  user_behaviour: UserBehaviour;
  behaviour_source: BehaviourSource;
  time: string;
};

export type BranchFeedbackDataset = {
  should_branch: BranchFeedbackSample[];
  should_not_branch: BranchFeedbackSample[];
};

type BranchFeedbackByUser = Record<string, BranchFeedbackDataset>;
type BehaviourDistribution = Record<BehaviourSource, number>;

export type UserBranchStats = {
  user_id: string;
  total: number;
  should_branch_count: number;
  should_not_branch_count: number;
  branch_rate: number;
  behaviour_source_ratio: BehaviourDistribution;
  depth_sensitivity_accept_rate: number;
  topical_continuity_reject_ignore_ratio: number;
};

export type PersonaProfile = {
  user_id: string;
  updated_at: string;
  stats: UserBranchStats;
  branch_aggressiveness: 'low' | 'mid' | 'high';
  offtopic_tolerance: 'low' | 'mid' | 'high';
  prefer_reuse_existing_branch: boolean;
  max_preferred_depth: 1 | 2 | 3;
};

const STORAGE_KEY = 'context-map.branch-feedback.by-user.v1';
const ACTIVE_USER_KEY = 'context-map.active-user-id';
const PROFILE_KEY = 'context-map.persona-profile.by-user.v1';
const BRANCH_DEBUG_KEY = 'context-map.branch-debug.enabled';
const PENDING_BRANCH_KEY = 'context-map.pending-branch-feedback.by-user.v1';

type PendingBranchFeedback = {
  target_base_path: string;
  sample: Omit<BranchFeedbackSample, 'time'>;
};

const emptyDataset = (): BranchFeedbackDataset => ({
  should_branch: [],
  should_not_branch: [],
});

export const readBranchFeedbackDataset = (): BranchFeedbackDataset => {
  const activeUserId = getActiveUserId();
  return readBranchFeedbackDatasetByUser(activeUserId);
};

export const readAllBranchFeedbackByUser = (): BranchFeedbackByUser => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as BranchFeedbackByUser;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export const readBranchFeedbackDatasetByUser = (userId: string | null): BranchFeedbackDataset => {
  if (!userId) return emptyDataset();
  if (typeof window === 'undefined') return emptyDataset();
  try {
    const parsed = readAllBranchFeedbackByUser();
    const dataset = parsed[userId];
    if (!dataset) return emptyDataset();
    return {
      should_branch: Array.isArray(dataset.should_branch) ? dataset.should_branch : [],
      should_not_branch: Array.isArray(dataset.should_not_branch) ? dataset.should_not_branch : [],
    };
  } catch {
    return emptyDataset();
  }
};

export const appendBranchFeedbackSample = (sample: BranchFeedbackSample) => {
  if (typeof window === 'undefined') return;
  const activeUserId = getActiveUserId();
  if (!activeUserId) return;
  const dataset = readBranchFeedbackDatasetByUser(activeUserId);
  if (sample.user_behaviour === 'branch') {
    dataset.should_branch.push(sample);
  } else {
    dataset.should_not_branch.push(sample);
  }
  try {
    const parsed = readAllBranchFeedbackByUser();
    parsed[activeUserId] = dataset;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore storage errors to avoid breaking chat flow.
  }
};

const readPendingBranchFeedbackByUser = (): Record<string, PendingBranchFeedback> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PENDING_BRANCH_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PendingBranchFeedback>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export const setPendingBranchFeedback = (targetBasePath: string, sample: Omit<BranchFeedbackSample, 'time'>) => {
  if (typeof window === 'undefined') return;
  const activeUserId = getActiveUserId();
  if (!activeUserId) return;
  const pendingByUser = readPendingBranchFeedbackByUser();
  pendingByUser[activeUserId] = {
    target_base_path: targetBasePath,
    sample,
  };
  try {
    window.localStorage.setItem(PENDING_BRANCH_KEY, JSON.stringify(pendingByUser));
  } catch {
    // Ignore storage errors.
  }
};

export const consumePendingBranchFeedback = (currentBasePath: string): BranchFeedbackSample | null => {
  if (typeof window === 'undefined') return null;
  const activeUserId = getActiveUserId();
  if (!activeUserId) return null;
  const pendingByUser = readPendingBranchFeedbackByUser();
  const pending = pendingByUser[activeUserId];
  if (!pending) return null;
  if (pending.target_base_path !== currentBasePath) return null;

  delete pendingByUser[activeUserId];
  try {
    window.localStorage.setItem(PENDING_BRANCH_KEY, JSON.stringify(pendingByUser));
  } catch {
    // Ignore storage errors.
  }

  return {
    ...pending.sample,
    time: new Date().toISOString(),
  };
};

export const getActiveUserId = (): string | null => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(ACTIVE_USER_KEY);
  const normalized = (raw || '').trim();
  return normalized || null;
};

export const setActiveUserId = (userId: string) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACTIVE_USER_KEY, userId.trim());
};

export const getBranchDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') return true;
  const raw = window.localStorage.getItem(BRANCH_DEBUG_KEY);
  if (raw === null) return true;
  return raw === '1';
};

export const setBranchDebugEnabled = (enabled: boolean) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(BRANCH_DEBUG_KEY, enabled ? '1' : '0');
};

export const logBranchDebug = (event: string, payload: unknown) => {
  if (!getBranchDebugEnabled()) return;
  console.log(`[branch-debug] ${event}`, payload);
};

export const logContextMapDebug = (event: string, payload: unknown) => {
  if (!getBranchDebugEnabled()) return;
  console.log(`[context-map-debug] ${event}`, payload);
};

const tokenize = (text: string): string[] => {
  const normalized = (text || '').toLowerCase().replace(/\s+/g, '');
  const grams: string[] = [];
  for (let i = 0; i < normalized.length - 1; i += 1) {
    grams.push(normalized.slice(i, i + 2));
  }
  return grams;
};

const jaccard = (a: string, b: string): number => {
  const aSet = new Set(tokenize(a));
  const bSet = new Set(tokenize(b));
  if (aSet.size === 0 && bSet.size === 0) return 1;
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let intersection = 0;
  aSet.forEach((token) => {
    if (bSet.has(token)) intersection += 1;
  });
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
};

const toRatio = (value: number, total: number): number => (total > 0 ? value / total : 0);

const getBehaviourSourceRatio = (samples: BranchFeedbackSample[]): BehaviourDistribution => {
  const total = samples.length || 1;
  const count = (source: BehaviourSource) => samples.filter((s) => s.behaviour_source === source).length;
  return {
    accept_branch: count('accept_branch') / total,
    reject_branch: count('reject_branch') / total,
    manually_branch: count('manually_branch') / total,
    ignore_branch: count('ignore_branch') / total,
  };
};

export const computeUserBranchStats = (userId: string): UserBranchStats => {
  const dataset = readBranchFeedbackDatasetByUser(userId);
  const positives = dataset.should_branch;
  const negatives = dataset.should_not_branch;
  const all = [...positives, ...negatives].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  const total = all.length;

  const suggestionEvents = all.filter((s) =>
    s.behaviour_source === 'accept_branch' ||
    s.behaviour_source === 'reject_branch' ||
    s.behaviour_source === 'ignore_branch'
  );
  const deepSuggestionEvents = suggestionEvents.filter((s) => s.level >= 3); // branch_depth>=2
  const deepAcceptCount = deepSuggestionEvents.filter((s) => s.behaviour_source === 'accept_branch').length;

  const topicalEvents = suggestionEvents.filter((event, idx) => {
    const prev = suggestionEvents[idx - 1];
    if (!prev) return false;
    const sameTopicScore = jaccard(event.current_node.user, prev.current_node.user);
    return sameTopicScore >= 0.25;
  });
  const topicalRejectIgnore = topicalEvents.filter((s) =>
    s.behaviour_source === 'reject_branch' || s.behaviour_source === 'ignore_branch'
  ).length;

  return {
    user_id: userId,
    total,
    should_branch_count: positives.length,
    should_not_branch_count: negatives.length,
    branch_rate: toRatio(positives.length, total),
    behaviour_source_ratio: getBehaviourSourceRatio(all),
    depth_sensitivity_accept_rate: toRatio(deepAcceptCount, deepSuggestionEvents.length),
    topical_continuity_reject_ignore_ratio: toRatio(topicalRejectIgnore, topicalEvents.length),
  };
};

const classifyLevel = (v: number, low: number, high: number): 'low' | 'mid' | 'high' => {
  if (v < low) return 'low';
  if (v > high) return 'high';
  return 'mid';
};

const inferMaxPreferredDepth = (samples: BranchFeedbackSample[]): 1 | 2 | 3 => {
  if (samples.length === 0) return 1;
  const level3Accepted = samples.filter((s) => s.level >= 3 && s.behaviour_source === 'accept_branch').length;
  if (level3Accepted >= 2) return 3;
  const level2Accepted = samples.filter((s) => s.level >= 2 && s.user_behaviour === 'branch').length;
  if (level2Accepted >= 2) return 2;
  return 1;
};

export const buildPersonaProfile = (userId: string): PersonaProfile => {
  const dataset = readBranchFeedbackDatasetByUser(userId);
  const all = [...dataset.should_branch, ...dataset.should_not_branch];
  const stats = computeUserBranchStats(userId);
  const branchAggressiveness = classifyLevel(stats.branch_rate, 0.3, 0.65);
  const offtopicTolerance = classifyLevel(1 - stats.topical_continuity_reject_ignore_ratio, 0.3, 0.65);
  const preferReuseExistingBranch = stats.topical_continuity_reject_ignore_ratio >= 0.55;
  const maxPreferredDepth = inferMaxPreferredDepth(all);

  return {
    user_id: userId,
    updated_at: new Date().toISOString(),
    stats,
    branch_aggressiveness: branchAggressiveness,
    offtopic_tolerance: offtopicTolerance,
    prefer_reuse_existing_branch: preferReuseExistingBranch,
    max_preferred_depth: maxPreferredDepth,
  };
};

export const savePersonaProfile = (profile: PersonaProfile) => {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, PersonaProfile>) : {};
    parsed[profile.user_id] = profile;
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore storage errors.
  }
};

export const readPersonaProfile = (userId: string): PersonaProfile | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, PersonaProfile>;
    return parsed[userId] || null;
  } catch {
    return null;
  }
};

export const readAllPersonaProfiles = (): Record<string, PersonaProfile> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PersonaProfile>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const normalize = (text: string, max = 220): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, max);

export const buildQAPair = (userNode?: Node | null, assistantNode?: Node | null): QAPair => ({
  user: normalize(userNode?.content || ''),
  assistant: normalize(assistantNode?.content || ''),
});
