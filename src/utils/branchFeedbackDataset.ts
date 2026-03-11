import { Node } from '../types';

export type BehaviourSource = 'manually_branch' | 'ignore_branch' | 'reject_branch' | 'accept_branch';
export type UserBehaviour = 'branch' | 'same_thread';

export type QAPair = {
  user: string;
  assistant: string;
};

export type BranchFeedbackSample = {
  sample_id?: string;
  current_tldr: string;
  visible_context?: QAPair[];
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

export type BranchFeedbackSyncRecord = BranchFeedbackSample & {
  sample_id: string;
  user_id: string;
  captured_at: string;
};

export type BranchFeedbackSyncState = {
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  pending_count: number;
  last_pull_attempt_at: string | null;
  last_pull_success_at: string | null;
  last_pull_error_at: string | null;
  last_pull_error_message: string | null;
};

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
const LOCAL_PENDING_SYNC_KEY = 'context-map.branch-feedback.pending-sync.v1';
const LOCAL_SYNC_STATUS_KEY = 'context-map.branch-feedback.sync-status.v1';
const SUPABASE_TABLE = 'branch_feedback';
const FALLBACK_LOCAL_USER_ID = 'local-anonymous';

type PendingBranchFeedback = {
  target_base_path: string;
  sample: Omit<BranchFeedbackSample, 'time'>;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type BranchFeedbackSyncRuntimeOptions = {
  storage: StorageLike;
  getEnv: () => {
    supabaseUrl: string;
    supabaseAnonKey: string;
  };
  fetchImpl: typeof fetch;
  getUserId: () => string | null;
  onStatusUpdated?: () => void;
};

const emptyDataset = (): BranchFeedbackDataset => ({
  should_branch: [],
  should_not_branch: [],
});

const hasWindow = () => typeof window !== 'undefined';

const readJson = <T>(storage: StorageLike, key: string, fallback: T): T => {
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const writeJson = <T>(storage: StorageLike, key: string, value: T) => {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage errors to preserve app flow.
  }
};

const normalizeUserIdForStorage = (getUserId: () => string | null): string => {
  const normalized = getUserId()?.trim() || '';
  return normalized || FALLBACK_LOCAL_USER_ID;
};

const createSampleId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `branch-feedback-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const sampleFingerprint = (sample: BranchFeedbackSample): string => JSON.stringify({
  current_tldr: sample.current_tldr,
  visible_context: sample.visible_context,
  history_last_3_qa: sample.history_last_3_qa,
  current_node: sample.current_node,
  level: sample.level,
  user_behaviour: sample.user_behaviour,
  behaviour_source: sample.behaviour_source,
  time: sample.time,
});

const getSampleIdentity = (sample: BranchFeedbackSample): string => sample.sample_id || sampleFingerprint(sample);

const normalizeBranchFeedbackSample = (sample: BranchFeedbackSample): BranchFeedbackSample => ({
  ...sample,
  sample_id: sample.sample_id || createSampleId(),
});

const normalizeDataset = (dataset: BranchFeedbackDataset | null | undefined): BranchFeedbackDataset => ({
  should_branch: Array.isArray(dataset?.should_branch) ? dataset!.should_branch : [],
  should_not_branch: Array.isArray(dataset?.should_not_branch) ? dataset!.should_not_branch : [],
});

const appendSampleToDataset = (dataset: BranchFeedbackDataset, sample: BranchFeedbackSample): BranchFeedbackDataset => {
  const normalizedSample = normalizeBranchFeedbackSample(sample);
  const identity = getSampleIdentity(normalizedSample);
  const next = normalizeDataset(dataset);
  const all = [...next.should_branch, ...next.should_not_branch];
  if (all.some((existing) => getSampleIdentity(existing) === identity)) {
    return next;
  }
  if (normalizedSample.user_behaviour === 'branch') {
    return {
      ...next,
      should_branch: [...next.should_branch, normalizedSample],
    };
  }
  return {
    ...next,
    should_not_branch: [...next.should_not_branch, normalizedSample],
  };
};

const sortSamples = (samples: BranchFeedbackSample[]): BranchFeedbackSample[] =>
  [...samples].sort((a, b) => {
    const byTime = new Date(a.time).getTime() - new Date(b.time).getTime();
    if (byTime !== 0) return byTime;
    return getSampleIdentity(a).localeCompare(getSampleIdentity(b));
  });

const toSyncRecord = (sample: BranchFeedbackSample, userId: string): BranchFeedbackSyncRecord => {
  const normalized = normalizeBranchFeedbackSample(sample);
  return {
    ...normalized,
    sample_id: normalized.sample_id as string,
    user_id: userId,
    captured_at: new Date().toISOString(),
  };
};

export const mergeRemoteBranchFeedbackDataset = (
  localDataset: BranchFeedbackDataset,
  remoteRecords: BranchFeedbackSyncRecord[]
): BranchFeedbackDataset => {
  let merged = normalizeDataset(localDataset);
  remoteRecords.forEach((record) => {
    merged = appendSampleToDataset(merged, record);
  });
  return {
    should_branch: sortSamples(merged.should_branch),
    should_not_branch: sortSamples(merged.should_not_branch),
  };
};

export const createBranchFeedbackSyncRuntime = ({
  storage,
  getEnv,
  fetchImpl,
  getUserId,
  onStatusUpdated,
}: BranchFeedbackSyncRuntimeOptions) => {
  let flushPromise: Promise<void> | null = null;

  const emitStatusUpdated = () => {
    onStatusUpdated?.();
  };

  const readAllByUser = (): BranchFeedbackByUser =>
    readJson<BranchFeedbackByUser>(storage, STORAGE_KEY, {});

  const readDatasetByUser = (userId: string | null): BranchFeedbackDataset => {
    if (!userId) return emptyDataset();
    return normalizeDataset(readAllByUser()[userId]);
  };

  const writeDatasetByUser = (userId: string, dataset: BranchFeedbackDataset) => {
    const parsed = readAllByUser();
    parsed[userId] = normalizeDataset(dataset);
    writeJson(storage, STORAGE_KEY, parsed);
  };

  const readPendingQueue = (): BranchFeedbackSyncRecord[] =>
    readJson<BranchFeedbackSyncRecord[]>(storage, LOCAL_PENDING_SYNC_KEY, []);

  const readSyncState = (): BranchFeedbackSyncState =>
    readJson<BranchFeedbackSyncState>(storage, LOCAL_SYNC_STATUS_KEY, {
      last_attempt_at: null,
      last_success_at: null,
      last_error_at: null,
      last_error_message: null,
      pending_count: readPendingQueue().length,
      last_pull_attempt_at: null,
      last_pull_success_at: null,
      last_pull_error_at: null,
      last_pull_error_message: null,
    });

  const writeSyncState = (patch: Partial<BranchFeedbackSyncState>) => {
    const next = {
      ...readSyncState(),
      ...patch,
    };
    writeJson(storage, LOCAL_SYNC_STATUS_KEY, next);
    emitStatusUpdated();
  };

  const upsertPending = (record: BranchFeedbackSyncRecord) => {
    const queue = readPendingQueue();
    const index = queue.findIndex((item) => item.sample_id === record.sample_id);
    if (index >= 0) {
      queue[index] = record;
    } else {
      queue.push(record);
    }
    writeJson(storage, LOCAL_PENDING_SYNC_KEY, queue);
    writeSyncState({ pending_count: queue.length });
  };

  const flushPendingInternal = async () => {
    const { supabaseUrl, supabaseAnonKey } = getEnv();
    if (!supabaseUrl || !supabaseAnonKey) return;

    let queue = readPendingQueue();
    if (queue.length === 0) return;

    writeSyncState({
      last_attempt_at: new Date().toISOString(),
      pending_count: queue.length,
    });

    const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${SUPABASE_TABLE}?on_conflict=sample_id`;
    while (queue.length > 0) {
      const batch = queue.slice(0, 100);
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=ignore-duplicates,return=minimal',
          },
          body: JSON.stringify(batch),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          writeSyncState({
            last_error_at: new Date().toISOString(),
            last_error_message: `HTTP ${response.status}: ${body || 'unknown error'}`,
            pending_count: queue.length,
          });
          return;
        }
      } catch {
        writeSyncState({
          last_error_at: new Date().toISOString(),
          last_error_message: 'Network request failed',
          pending_count: queue.length,
        });
        return;
      }

      queue = queue.slice(batch.length);
      writeJson(storage, LOCAL_PENDING_SYNC_KEY, queue);
      writeSyncState({ pending_count: queue.length });
    }

    writeSyncState({
      last_success_at: new Date().toISOString(),
      last_error_message: null,
      pending_count: 0,
    });
  };

  const flushPending = async () => {
    if (flushPromise) return flushPromise;
    flushPromise = flushPendingInternal().finally(() => {
      flushPromise = null;
    });
    return flushPromise;
  };

  const appendSample = (sample: BranchFeedbackSample): BranchFeedbackSample | null => {
    const userId = normalizeUserIdForStorage(getUserId);
    if (!userId) return null;
    const normalized = normalizeBranchFeedbackSample(sample);
    const nextDataset = appendSampleToDataset(readDatasetByUser(userId), normalized);
    writeDatasetByUser(userId, nextDataset);
    upsertPending(toSyncRecord(normalized, userId));
    void flushPending();
    return normalized;
  };

  const pullRemoteBranchFeedback = async (): Promise<BranchFeedbackSyncRecord[]> => {
    const { supabaseUrl, supabaseAnonKey } = getEnv();
    const userId = normalizeUserIdForStorage(getUserId);
    if (!supabaseUrl || !supabaseAnonKey || !userId) return [];

    writeSyncState({
      last_pull_attempt_at: new Date().toISOString(),
    });

    try {
      const endpoint = new URL(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${SUPABASE_TABLE}`);
      endpoint.searchParams.set('select', '*');
      endpoint.searchParams.set('user_id', `eq.${userId}`);
      endpoint.searchParams.set('order', 'time.asc');

      const response = await fetchImpl(endpoint.toString(), {
        method: 'GET',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        writeSyncState({
          last_pull_error_at: new Date().toISOString(),
          last_pull_error_message: `HTTP ${response.status}: ${body || 'unknown error'}`,
        });
        return [];
      }

      const records = (await response.json().catch(() => [])) as BranchFeedbackSyncRecord[];
      writeSyncState({
        last_pull_success_at: new Date().toISOString(),
        last_pull_error_message: null,
      });
      return Array.isArray(records) ? records : [];
    } catch {
      writeSyncState({
        last_pull_error_at: new Date().toISOString(),
        last_pull_error_message: 'Network request failed',
      });
      return [];
    }
  };

  const mergeRemoteRecordsIntoLocal = (userId: string, remoteRecords: BranchFeedbackSyncRecord[]) => {
    const merged = mergeRemoteBranchFeedbackDataset(readDatasetByUser(userId), remoteRecords);
    writeDatasetByUser(userId, merged);
    return merged;
  };

  return {
    appendSample,
    flushPending,
    pullRemoteBranchFeedback,
    mergeRemoteRecordsIntoLocal,
    readLocalDatasetByUser: readDatasetByUser,
    readPendingQueue,
    readSyncState,
  };
};

export const readBranchFeedbackDataset = (): BranchFeedbackDataset => {
  const activeUserId = getActiveUserId();
  return readBranchFeedbackDatasetByUser(activeUserId);
};

export const readAllBranchFeedbackByUser = (): BranchFeedbackByUser => {
  if (!hasWindow()) return {};
  return readJson<BranchFeedbackByUser>(window.localStorage, STORAGE_KEY, {});
};

export const readBranchFeedbackDatasetByUser = (userId: string | null): BranchFeedbackDataset => {
  if (!userId || !hasWindow()) return emptyDataset();
  return normalizeDataset(readAllBranchFeedbackByUser()[userId]);
};

export const appendBranchFeedbackSample = (sample: BranchFeedbackSample) => {
  defaultRuntime?.appendSample(sample);
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
  if (!hasWindow()) return {};
  return readJson<Record<string, PersonaProfile>>(window.localStorage, PROFILE_KEY, {});
};

const normalize = (text: string, max = 220): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, max);

export const buildQAPair = (userNode?: Node | null, assistantNode?: Node | null): QAPair => ({
  user: normalize(userNode?.content || ''),
  assistant: normalize(assistantNode?.content || ''),
});

const defaultRuntime = (() => {
  if (!hasWindow()) return null;

  return createBranchFeedbackSyncRuntime({
    storage: window.localStorage,
    getEnv: () => ({
      supabaseUrl: ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_URL || '').trim(),
      supabaseAnonKey: ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_ANON_KEY || '').trim(),
    }),
    fetchImpl: fetch,
    getUserId: () => getActiveUserId(),
    onStatusUpdated: () => {
      window.dispatchEvent(new CustomEvent('branch-feedback-sync-updated'));
    },
  });
})();

export const flushBranchFeedbackSyncQueue = async () => {
  if (!defaultRuntime) return;
  await defaultRuntime.flushPending();
};

export const startBranchFeedbackSync = () => {
  if (!hasWindow() || !defaultRuntime) return () => {};

  const onOnline = () => {
    void flushBranchFeedbackSyncQueue();
  };

  const onVisible = () => {
    if (typeof document !== 'undefined' && !document.hidden) {
      void flushBranchFeedbackSyncQueue();
    }
  };

  window.addEventListener('online', onOnline);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
  }

  const timer = window.setInterval(() => {
    void flushBranchFeedbackSyncQueue();
  }, 15000);

  void flushBranchFeedbackSyncQueue();

  return () => {
    window.removeEventListener('online', onOnline);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisible);
    }
    window.clearInterval(timer);
  };
};

export const readBranchFeedbackSyncState = (): BranchFeedbackSyncState =>
  defaultRuntime
    ? defaultRuntime.readSyncState()
    : {
        last_attempt_at: null,
        last_success_at: null,
        last_error_at: null,
        last_error_message: null,
        pending_count: 0,
        last_pull_attempt_at: null,
        last_pull_success_at: null,
        last_pull_error_at: null,
        last_pull_error_message: null,
      };

export const pullRemoteBranchFeedback = async (): Promise<BranchFeedbackSyncRecord[]> => {
  if (!defaultRuntime) return [];
  return defaultRuntime.pullRemoteBranchFeedback();
};

export const mergeBranchFeedbackFromRemoteRecords = (remoteRecords: BranchFeedbackSyncRecord[]) => {
  if (!defaultRuntime) return emptyDataset();
  const userId = getActiveUserId();
  if (!userId) return emptyDataset();
  return defaultRuntime.mergeRemoteRecordsIntoLocal(userId, remoteRecords);
};
