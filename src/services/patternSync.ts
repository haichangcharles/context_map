import type { Pattern } from '../types';
import { getActiveUserId } from '../utils/branchFeedbackDataset';

export type PatternSyncRecord = {
  pattern_id: string;
  user_id: string;
  type: Pattern['type'];
  name: string;
  requires_human_review: boolean;
  instruction: string;
  example: string;
  review_status: Pattern['review_status'];
  source_from_node_id: string;
  source_to_node_id: string;
  created_at: string;
  updated_at: string;
  created_from_project_id: string | null;
  is_deleted: boolean;
  captured_at: string;
};

type PatternHistoryByUser = Record<string, PatternSyncRecord[]>;

export type PatternSyncState = {
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

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type PatternSyncRuntimeOptions = {
  storage: StorageLike;
  getEnv: () => {
    supabaseUrl: string;
    supabaseAnonKey: string;
  };
  fetchImpl: typeof fetch;
  getUserId: () => string | null;
  onStatusUpdated?: () => void;
};

const LOCAL_PATTERN_HISTORY_KEY = 'context-map.pattern-history.by-user.v1';
const LOCAL_PENDING_SYNC_KEY = 'context-map.pattern-history.pending-sync.v1';
const LOCAL_SYNC_STATUS_KEY = 'context-map.pattern-history.sync-status.v1';
const SUPABASE_TABLE = 'patterns';
const MAX_LOCAL_PATTERN_EVENTS_PER_USER = 5000;
const FALLBACK_LOCAL_USER_ID = 'local-anonymous';

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

const normalizeUserId = (getUserId: () => string | null): string => {
  const raw = getUserId();
  const trimmed = raw?.trim() || '';
  return trimmed || FALLBACK_LOCAL_USER_ID;
};

const toPatternSyncRecord = (pattern: Pattern, userId: string, isDeleted: boolean): PatternSyncRecord => ({
  pattern_id: pattern.pattern_id,
  user_id: userId,
  type: pattern.type,
  name: pattern.name,
  requires_human_review: pattern.requires_human_review,
  instruction: pattern.instruction,
  example: pattern.example,
  review_status: pattern.review_status,
  source_from_node_id: pattern.source_line.from,
  source_to_node_id: pattern.source_line.to,
  created_at: pattern.created_at,
  updated_at: pattern.updated_at,
  created_from_project_id: pattern.created_from_project_id || null,
  is_deleted: isDeleted,
  captured_at: new Date().toISOString(),
});

const toEpoch = (value: string | null | undefined): number => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toPattern = (record: PatternSyncRecord): Pattern => ({
  pattern_id: record.pattern_id,
  type: record.type,
  name: record.name,
  requires_human_review: record.requires_human_review,
  instruction: record.instruction,
  example: record.example,
  review_status: record.review_status,
  source_line: {
    from: record.source_from_node_id,
    to: record.source_to_node_id,
  },
  created_at: record.created_at,
  updated_at: record.updated_at,
  created_from_project_id: record.created_from_project_id || undefined,
});

export const mergeRemotePatternsIntoPatterns = (
  localPatterns: Record<string, Pattern>,
  remoteRecords: PatternSyncRecord[]
): Record<string, Pattern> => {
  const next = { ...localPatterns };

  remoteRecords.forEach((record) => {
    const existing = next[record.pattern_id];
    const remoteUpdatedAt = toEpoch(record.updated_at);
    const localUpdatedAt = toEpoch(existing?.updated_at);

    if (existing && localUpdatedAt > remoteUpdatedAt) {
      return;
    }

    if (record.is_deleted) {
      delete next[record.pattern_id];
      return;
    }

    next[record.pattern_id] = toPattern(record);
  });

  return next;
};

export const createPatternSyncRuntime = ({
  storage,
  getEnv,
  fetchImpl,
  getUserId,
  onStatusUpdated,
}: PatternSyncRuntimeOptions) => {
  let flushPromise: Promise<void> | null = null;

  const emitStatusUpdated = () => {
    onStatusUpdated?.();
  };

  const readSyncState = (): PatternSyncState =>
    readJson<PatternSyncState>(storage, LOCAL_SYNC_STATUS_KEY, {
      last_attempt_at: null,
      last_success_at: null,
      last_error_at: null,
      last_error_message: null,
      pending_count: readJson<PatternSyncRecord[]>(storage, LOCAL_PENDING_SYNC_KEY, []).length,
      last_pull_attempt_at: null,
      last_pull_success_at: null,
      last_pull_error_at: null,
      last_pull_error_message: null,
    });

  const writeSyncState = (patch: Partial<PatternSyncState>) => {
    const next = {
      ...readSyncState(),
      ...patch,
    };
    writeJson(storage, LOCAL_SYNC_STATUS_KEY, next);
    emitStatusUpdated();
  };

  const appendLocalHistory = (record: PatternSyncRecord) => {
    const byUser = readJson<PatternHistoryByUser>(storage, LOCAL_PATTERN_HISTORY_KEY, {});
    const existing = byUser[record.user_id] || [];
    byUser[record.user_id] = [...existing, record].slice(-MAX_LOCAL_PATTERN_EVENTS_PER_USER);
    writeJson(storage, LOCAL_PATTERN_HISTORY_KEY, byUser);
  };

  const upsertPending = (record: PatternSyncRecord) => {
    const queue = readJson<PatternSyncRecord[]>(storage, LOCAL_PENDING_SYNC_KEY, []);
    const index = queue.findIndex((item) => item.pattern_id === record.pattern_id);
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

    let queue = readJson<PatternSyncRecord[]>(storage, LOCAL_PENDING_SYNC_KEY, []);
    if (queue.length === 0) return;

    writeSyncState({
      last_attempt_at: new Date().toISOString(),
      pending_count: queue.length,
    });

    const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${SUPABASE_TABLE}?on_conflict=pattern_id`;
    while (queue.length > 0) {
      const batch = queue.slice(0, 100);
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
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

  const pullRemotePatterns = async (): Promise<PatternSyncRecord[]> => {
    const { supabaseUrl, supabaseAnonKey } = getEnv();
    const userId = normalizeUserId(getUserId);
    if (!supabaseUrl || !supabaseAnonKey || !userId) return [];

    writeSyncState({
      last_pull_attempt_at: new Date().toISOString(),
    });

    try {
      const endpoint = new URL(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${SUPABASE_TABLE}`);
      endpoint.searchParams.set('select', '*');
      endpoint.searchParams.set('user_id', `eq.${userId}`);
      endpoint.searchParams.set('order', 'updated_at.desc');

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

      const records = (await response.json().catch(() => [])) as PatternSyncRecord[];
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

  const writeRecord = (pattern: Pattern, isDeleted: boolean) => {
    const userId = normalizeUserId(getUserId);
    const record = toPatternSyncRecord(pattern, userId, isDeleted);
    appendLocalHistory(record);
    upsertPending(record);
    void flushPending();
  };

  return {
    flushPending,
    logPatternUpsert: (pattern: Pattern) => writeRecord(pattern, false),
    logPatternDelete: (pattern: Pattern) => writeRecord(pattern, true),
    pullRemotePatterns,
    readLocalPatternHistory: () => readJson<PatternHistoryByUser>(storage, LOCAL_PATTERN_HISTORY_KEY, {}),
    readSyncState,
  };
};

const hasWindow = () => typeof window !== 'undefined';

const defaultRuntime = (() => {
  if (!hasWindow()) return null;

  return createPatternSyncRuntime({
    storage: window.localStorage,
    getEnv: () => ({
      supabaseUrl: ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_URL || '').trim(),
      supabaseAnonKey: ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_ANON_KEY || '').trim(),
    }),
    fetchImpl: fetch,
    getUserId: () => getActiveUserId(),
    onStatusUpdated: () => {
      window.dispatchEvent(new CustomEvent('pattern-sync-updated'));
    },
  });
})();

export const flushPatternSyncQueue = async () => {
  if (!defaultRuntime) return;
  await defaultRuntime.flushPending();
};

export const startPatternSync = () => {
  if (!hasWindow() || !defaultRuntime) return () => {};

  const onOnline = () => {
    void flushPatternSyncQueue();
  };

  const onVisible = () => {
    if (typeof document !== 'undefined' && !document.hidden) {
      void flushPatternSyncQueue();
    }
  };

  window.addEventListener('online', onOnline);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
  }

  const timer = window.setInterval(() => {
    void flushPatternSyncQueue();
  }, 15000);

  void flushPatternSyncQueue();

  return () => {
    window.removeEventListener('online', onOnline);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisible);
    }
    window.clearInterval(timer);
  };
};

export const readPatternSyncState = (): PatternSyncState =>
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

export const logPatternUpsert = async (pattern: Pattern) => {
  if (!defaultRuntime) return;
  defaultRuntime.logPatternUpsert(pattern);
};

export const logPatternDelete = async (pattern: Pattern) => {
  if (!defaultRuntime) return;
  defaultRuntime.logPatternDelete(pattern);
};

export const pullRemotePatterns = async (): Promise<PatternSyncRecord[]> => {
  if (!defaultRuntime) return [];
  return defaultRuntime.pullRemotePatterns();
};
