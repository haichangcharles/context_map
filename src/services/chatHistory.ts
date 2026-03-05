import { Node } from '../types';
import { getActiveUserId } from '../utils/branchFeedbackDataset';

type ChatHistoryRecord = {
  message_id: string;
  user_id: string;
  project_id: string;
  parent_id: string | null;
  branch_id: string | null;
  role: Node['role'];
  content: string;
  message_timestamp: string;
  captured_at: string;
};

type ChatHistoryByUser = Record<string, ChatHistoryRecord[]>;
type ChatSyncState = {
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  pending_count: number;
};

const LOCAL_CHAT_HISTORY_KEY = 'context-map.chat-history.by-user.v1';
const LOCAL_PENDING_SYNC_KEY = 'context-map.chat-history.pending-sync.v1';
const LOCAL_SYNC_STATUS_KEY = 'context-map.chat-history.sync-status.v1';
const SUPABASE_TABLE = 'chat_history';
const MAX_LOCAL_MESSAGES_PER_USER = 5000;
const FALLBACK_LOCAL_USER_ID = 'local-anonymous';

let flushPromise: Promise<void> | null = null;

const emitSyncStatusUpdated = () => {
  if (!hasWindow()) return;
  window.dispatchEvent(new CustomEvent('chat-history-sync-updated'));
};

const readSyncState = (): ChatSyncState =>
  readJson<ChatSyncState>(LOCAL_SYNC_STATUS_KEY, {
    last_attempt_at: null,
    last_success_at: null,
    last_error_at: null,
    last_error_message: null,
    pending_count: readJson<ChatHistoryRecord[]>(LOCAL_PENDING_SYNC_KEY, []).length,
  });

const writeSyncState = (patch: Partial<ChatSyncState>) => {
  const next = {
    ...readSyncState(),
    ...patch,
  };
  writeJson(LOCAL_SYNC_STATUS_KEY, next);
  emitSyncStatusUpdated();
};

const hasWindow = () => typeof window !== 'undefined';

const readJson = <T>(key: string, fallback: T): T => {
  if (!hasWindow()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const writeJson = <T>(key: string, value: T) => {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage errors to avoid breaking chat flow.
  }
};

const normalizeUserId = (): string | null => {
  const activeUserId = getActiveUserId();
  if (!activeUserId) return FALLBACK_LOCAL_USER_ID;
  const normalized = activeUserId.trim();
  return normalized || FALLBACK_LOCAL_USER_ID;
};

const appendLocalHistory = (record: ChatHistoryRecord) => {
  const byUser = readJson<ChatHistoryByUser>(LOCAL_CHAT_HISTORY_KEY, {});
  const existing = byUser[record.user_id] || [];
  const merged = [...existing, record];
  byUser[record.user_id] = merged.slice(-MAX_LOCAL_MESSAGES_PER_USER);
  writeJson(LOCAL_CHAT_HISTORY_KEY, byUser);
};

const upsertPending = (record: ChatHistoryRecord) => {
  const queue = readJson<ChatHistoryRecord[]>(LOCAL_PENDING_SYNC_KEY, []);
  const index = queue.findIndex((item) => item.message_id === record.message_id);
  if (index >= 0) {
    queue[index] = record;
  } else {
    queue.push(record);
  }
  writeJson(LOCAL_PENDING_SYNC_KEY, queue);
  writeSyncState({ pending_count: queue.length });
};

const getSupabaseConfig = () => {
  const url = (import.meta.env.VITE_SUPABASE_URL || '').trim();
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) return null;
  return {
    url: url.replace(/\/+$/, ''),
    anonKey,
  };
};

const flushPendingInternal = async () => {
  const config = getSupabaseConfig();
  if (!config || !hasWindow()) return;

  let queue = readJson<ChatHistoryRecord[]>(LOCAL_PENDING_SYNC_KEY, []);
  if (queue.length === 0) return;
  writeSyncState({
    last_attempt_at: new Date().toISOString(),
    pending_count: queue.length,
  });

  const endpoint = `${config.url}/rest/v1/${SUPABASE_TABLE}?on_conflict=message_id`;
  while (queue.length > 0) {
    const batch = queue.slice(0, 100);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify(batch),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.warn('[chat-history] supabase sync failed', {
          status: response.status,
          body,
        });
        writeSyncState({
          last_error_at: new Date().toISOString(),
          last_error_message: `HTTP ${response.status}: ${body || 'unknown error'}`,
          pending_count: queue.length,
        });
        return;
      }
    } catch {
      console.warn('[chat-history] supabase sync request error');
      writeSyncState({
        last_error_at: new Date().toISOString(),
        last_error_message: 'Network request failed',
        pending_count: queue.length,
      });
      return;
    }

    queue = queue.slice(batch.length);
    writeJson(LOCAL_PENDING_SYNC_KEY, queue);
    writeSyncState({ pending_count: queue.length });
  }

  writeSyncState({
    last_success_at: new Date().toISOString(),
    last_error_message: null,
    pending_count: 0,
  });
};

export const flushChatHistoryQueue = async () => {
  if (flushPromise) return flushPromise;
  flushPromise = flushPendingInternal().finally(() => {
    flushPromise = null;
  });
  return flushPromise;
};

export const startChatHistorySync = () => {
  if (!hasWindow()) return () => {};

  const onOnline = () => {
    void flushChatHistoryQueue();
  };

  const onVisible = () => {
    if (typeof document !== 'undefined' && !document.hidden) {
      void flushChatHistoryQueue();
    }
  };

  window.addEventListener('online', onOnline);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
  }

  const timer = window.setInterval(() => {
    void flushChatHistoryQueue();
  }, 15000);

  void flushChatHistoryQueue();

  return () => {
    window.removeEventListener('online', onOnline);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisible);
    }
    window.clearInterval(timer);
  };
};

export const readChatHistorySyncState = (): ChatSyncState => readSyncState();

export const logChatNode = async (node: Node) => {
  const userId = normalizeUserId();
  if (!userId) return;

  const record: ChatHistoryRecord = {
    message_id: node.node_id,
    user_id: userId,
    project_id: node.project_id,
    parent_id: node.parent_id,
    branch_id: node.branch_id,
    role: node.role,
    content: node.content,
    message_timestamp: node.timestamp,
    captured_at: new Date().toISOString(),
  };

  appendLocalHistory(record);
  upsertPending(record);
  void flushChatHistoryQueue();
};
