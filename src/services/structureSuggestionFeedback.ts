import type { QAPair } from '../utils/branchFeedbackDataset';
import { getActiveUserId } from '../utils/branchFeedbackDataset';

export type StructureSuggestionKind = 'return_parent' | 'extract_reasoning' | 'extract_task_sop';
export type StructureSuggestionOriginKind = 'structure' | 'branch_extract';
export type StructureSuggestionDecision = 'shown' | 'accepted' | 'rejected' | 'ignored' | 'expired';

export type StructureSuggestionFeedbackEvent = {
  event_id: string;
  suggestion_id: string;
  user_id: string;
  project_id: string | null;
  base_path: string | null;
  target_node_id: string | null;
  suggestion_kind: StructureSuggestionKind;
  origin_kind: StructureSuggestionOriginKind;
  decision: StructureSuggestionDecision;
  current_tldr: string;
  history_last_3_qa: QAPair[];
  current_node: QAPair;
  suggestion_payload: Record<string, unknown>;
  shown_at: string;
  decided_at: string | null;
  captured_at: string;
};

export type StructureSuggestionFeedbackInput = Omit<
  StructureSuggestionFeedbackEvent,
  'event_id' | 'user_id' | 'captured_at'
>;

export type StructureSuggestionSyncState = {
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

type RuntimeOptions = {
  storage: StorageLike;
  getEnv: () => {
    supabaseUrl: string;
    supabaseAnonKey: string;
  };
  fetchImpl: typeof fetch;
  getUserId: () => string | null;
  onStatusUpdated?: () => void;
};

const LOCAL_HISTORY_KEY = 'context-map.structure-suggestion-feedback.by-user.v1';
const LOCAL_PENDING_SYNC_KEY = 'context-map.structure-suggestion-feedback.pending-sync.v1';
const LOCAL_SYNC_STATUS_KEY = 'context-map.structure-suggestion-feedback.sync-status.v1';
const SUPABASE_TABLE = 'structure_suggestion_feedback';
const FALLBACK_LOCAL_USER_ID = 'local-anonymous';

type StructureSuggestionFeedbackByUser = Record<string, StructureSuggestionFeedbackEvent[]>;

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
    // Ignore storage errors.
  }
};

const createId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const normalizeUserId = (getUserId: () => string | null): string => {
  const raw = getUserId()?.trim() || '';
  return raw || FALLBACK_LOCAL_USER_ID;
};

const sortEvents = (events: StructureSuggestionFeedbackEvent[]): StructureSuggestionFeedbackEvent[] =>
  [...events].sort((a, b) => {
    const byShownAt = new Date(a.shown_at).getTime() - new Date(b.shown_at).getTime();
    if (byShownAt !== 0) return byShownAt;
    const byCapturedAt = new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime();
    if (byCapturedAt !== 0) return byCapturedAt;
    return a.event_id.localeCompare(b.event_id);
  });

export const mergeRemoteStructureSuggestionFeedback = (
  localEvents: StructureSuggestionFeedbackEvent[],
  remoteEvents: StructureSuggestionFeedbackEvent[]
): StructureSuggestionFeedbackEvent[] => {
  const merged = new Map<string, StructureSuggestionFeedbackEvent>();
  [...localEvents, ...remoteEvents].forEach((event) => {
    merged.set(event.event_id, event);
  });
  return sortEvents(Array.from(merged.values()));
};

export const createStructureSuggestionFeedbackRuntime = ({
  storage,
  getEnv,
  fetchImpl,
  getUserId,
  onStatusUpdated,
}: RuntimeOptions) => {
  let flushPromise: Promise<void> | null = null;

  const emitStatusUpdated = () => {
    onStatusUpdated?.();
  };

  const readAllHistory = (): StructureSuggestionFeedbackByUser =>
    readJson<StructureSuggestionFeedbackByUser>(storage, LOCAL_HISTORY_KEY, {});

  const readLocalHistoryByUser = (userId: string | null): StructureSuggestionFeedbackEvent[] => {
    if (!userId) return [];
    return sortEvents(readAllHistory()[userId] || []);
  };

  const writeLocalHistoryByUser = (userId: string, events: StructureSuggestionFeedbackEvent[]) => {
    const all = readAllHistory();
    all[userId] = sortEvents(events);
    writeJson(storage, LOCAL_HISTORY_KEY, all);
  };

  const readPendingQueue = (): StructureSuggestionFeedbackEvent[] =>
    readJson<StructureSuggestionFeedbackEvent[]>(storage, LOCAL_PENDING_SYNC_KEY, []);

  const readSyncState = (): StructureSuggestionSyncState =>
    readJson<StructureSuggestionSyncState>(storage, LOCAL_SYNC_STATUS_KEY, {
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

  const writeSyncState = (patch: Partial<StructureSuggestionSyncState>) => {
    const next = {
      ...readSyncState(),
      ...patch,
    };
    writeJson(storage, LOCAL_SYNC_STATUS_KEY, next);
    emitStatusUpdated();
  };

  const upsertPending = (event: StructureSuggestionFeedbackEvent) => {
    const queue = readPendingQueue();
    const index = queue.findIndex((item) => item.event_id === event.event_id);
    if (index >= 0) {
      queue[index] = event;
    } else {
      queue.push(event);
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

    const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${SUPABASE_TABLE}?on_conflict=event_id`;
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

  const logEvent = (input: StructureSuggestionFeedbackInput): StructureSuggestionFeedbackEvent => {
    const userId = normalizeUserId(getUserId);
    const event: StructureSuggestionFeedbackEvent = {
      ...input,
      event_id: createId('structure-suggestion-event'),
      user_id: userId,
      captured_at: new Date().toISOString(),
    };
    const merged = mergeRemoteStructureSuggestionFeedback(readLocalHistoryByUser(userId), [event]);
    writeLocalHistoryByUser(userId, merged);
    upsertPending(event);
    void flushPending();
    return event;
  };

  const pullRemoteEvents = async (): Promise<StructureSuggestionFeedbackEvent[]> => {
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
      endpoint.searchParams.set('order', 'shown_at.asc');
      endpoint.searchParams.set('order', 'captured_at.asc');

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

      const records = (await response.json().catch(() => [])) as StructureSuggestionFeedbackEvent[];
      writeSyncState({
        last_pull_success_at: new Date().toISOString(),
        last_pull_error_message: null,
      });
      return Array.isArray(records) ? sortEvents(records) : [];
    } catch {
      writeSyncState({
        last_pull_error_at: new Date().toISOString(),
        last_pull_error_message: 'Network request failed',
      });
      return [];
    }
  };

  const mergeRemoteEventsIntoLocal = (userId: string, remoteEvents: StructureSuggestionFeedbackEvent[]) => {
    const merged = mergeRemoteStructureSuggestionFeedback(readLocalHistoryByUser(userId), remoteEvents);
    writeLocalHistoryByUser(userId, merged);
    return merged;
  };

  return {
    logEvent,
    flushPending,
    pullRemoteEvents,
    mergeRemoteEventsIntoLocal,
    readLocalHistoryByUser,
    readPendingQueue,
    readSyncState,
  };
};

const defaultRuntime = (() => {
  if (!hasWindow()) return null;

  return createStructureSuggestionFeedbackRuntime({
    storage: window.localStorage,
    getEnv: () => ({
      supabaseUrl: ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_URL || '').trim(),
      supabaseAnonKey: ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_ANON_KEY || '').trim(),
    }),
    fetchImpl: fetch,
    getUserId: () => getActiveUserId(),
    onStatusUpdated: () => {
      window.dispatchEvent(new CustomEvent('structure-suggestion-feedback-sync-updated'));
    },
  });
})();

export const logStructureSuggestionFeedbackEvent = (input: StructureSuggestionFeedbackInput) => {
  if (!defaultRuntime) return null;
  return defaultRuntime.logEvent(input);
};

export const pullRemoteStructureSuggestionFeedback = async (): Promise<StructureSuggestionFeedbackEvent[]> => {
  if (!defaultRuntime) return [];
  return defaultRuntime.pullRemoteEvents();
};

export const mergeStructureSuggestionFeedbackFromRemote = (events: StructureSuggestionFeedbackEvent[]) => {
  if (!defaultRuntime) return [];
  const userId = getActiveUserId();
  if (!userId) return [];
  return defaultRuntime.mergeRemoteEventsIntoLocal(userId, events);
};

export const readStructureSuggestionFeedbackSyncState = (): StructureSuggestionSyncState =>
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

export const startStructureSuggestionFeedbackSync = () => {
  if (!hasWindow() || !defaultRuntime) return () => {};

  const onOnline = () => {
    void defaultRuntime.flushPending();
  };

  const onVisible = () => {
    if (typeof document !== 'undefined' && !document.hidden) {
      void defaultRuntime.flushPending();
    }
  };

  window.addEventListener('online', onOnline);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
  }

  const timer = window.setInterval(() => {
    void defaultRuntime.flushPending();
  }, 15000);

  void defaultRuntime.flushPending();

  return () => {
    window.removeEventListener('online', onOnline);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisible);
    }
    window.clearInterval(timer);
  };
};
