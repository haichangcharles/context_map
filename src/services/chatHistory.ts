import { Branch, ContextView, Node, Pattern, Project } from '../types';
import { getActiveUserId } from '../utils/branchFeedbackDataset';

export type ChatHistoryRecord = {
  message_id: string;
  user_id: string;
  project_id: string;
  project_title?: string | null;
  parent_id: string | null;
  branch_id: string | null;
  role: Node['role'];
  content: string;
  message_timestamp: string;
  captured_at: string;
};

type ChatHistoryByUser = Record<string, ChatHistoryRecord[]>;
export type ChatSyncState = {
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

export type RecoveredChatState = {
  projects: Record<string, Project>;
  nodes: Record<string, Node>;
  branches: Record<string, Branch>;
  mainlines: Record<string, string[]>;
  contexts: Record<string, ContextView>;
  naturalMainlines: Record<string, string[]>;
  naturalBranches: Record<string, Branch>;
  patterns: Record<string, Pattern>;
  pastStructureSnapshots: [];
  futureStructureSnapshots: [];
  activeProjectId: string | null;
};

const LOCAL_CHAT_HISTORY_KEY = 'context-map.chat-history.by-user.v1';
const LOCAL_PENDING_SYNC_KEY = 'context-map.chat-history.pending-sync.v1';
const LOCAL_SYNC_STATUS_KEY = 'context-map.chat-history.sync-status.v1';
const SUPABASE_TABLE = 'chat_history';
const MAX_LOCAL_MESSAGES_PER_USER = 5000;
const FALLBACK_LOCAL_USER_ID = 'local-anonymous';

let flushPromise: Promise<void> | null = null;
let supportsRemoteProjectTitle: boolean | null = null;

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
    last_pull_attempt_at: null,
    last_pull_success_at: null,
    last_pull_error_at: null,
    last_pull_error_message: null,
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

const sortRecordsChronologically = (records: ChatHistoryRecord[]) =>
  [...records].sort((a, b) => {
    const byTimestamp = new Date(a.message_timestamp).getTime() - new Date(b.message_timestamp).getTime();
    if (byTimestamp !== 0) return byTimestamp;
    return a.message_id.localeCompare(b.message_id);
  });

const buildRecoveredProjectTitle = (projectId: string) => `Recovered ${projectId.slice(0, 8)}`;

const resolveRecoveredProjectTitle = (projectId: string, projectRecords: ChatHistoryRecord[]) => {
  for (let index = projectRecords.length - 1; index >= 0; index -= 1) {
    const candidate = projectRecords[index]?.project_title?.trim();
    if (candidate) return candidate;
  }
  return buildRecoveredProjectTitle(projectId);
};

export const reconstructChatStateFromRecords = (records: ChatHistoryRecord[]): RecoveredChatState => {
  const ordered = sortRecordsChronologically(records);
  const nodes: Record<string, Node> = {};
  const branches: Record<string, Branch> = {};
  const mainlines: Record<string, string[]> = {};
  const projects: Record<string, Project> = {};
  const contexts: Record<string, ContextView> = {};
  const naturalMainlines: Record<string, string[]> = {};
  const naturalBranches: Record<string, Branch> = {};
  const orderedByProject = new Map<string, ChatHistoryRecord[]>();

  ordered.forEach((record) => {
    if (!orderedByProject.has(record.project_id)) orderedByProject.set(record.project_id, []);
    orderedByProject.get(record.project_id)!.push(record);
    nodes[record.message_id] = {
      node_id: record.message_id,
      project_id: record.project_id,
      parent_id: record.parent_id,
      role: record.role,
      content: record.content,
      branch_id: record.branch_id,
      timestamp: record.message_timestamp,
      metadata: {
        natural_origin_branch_id: record.branch_id,
      },
    };
  });

  for (const [projectId, projectRecords] of orderedByProject.entries()) {
    const contextId = `restored-context:${projectId}`;
    const mainlineIds = projectRecords.filter((record) => record.branch_id === null).map((record) => record.message_id);
    mainlines[projectId] = mainlineIds;
    naturalMainlines[projectId] = [...mainlineIds];

    const rootNodeId =
      projectRecords.find((record) => record.parent_id === null)?.message_id ||
      mainlineIds[0] ||
      projectRecords[0]?.message_id ||
      null;

    projects[projectId] = {
      project_id: projectId,
      title: resolveRecoveredProjectTitle(projectId, projectRecords),
      root_node_id: rootNodeId,
      mainline_id: `mainline_${projectId}`,
      active_context_id: contextId,
    };

    contexts[contextId] = {
      context_id: contextId,
      project_id: projectId,
      base_path: 'mainline',
      included_nodes: [],
      excluded_nodes: [],
      enabled_patterns_by_type: {},
    };

    const branchIds = Array.from(
      new Set(projectRecords.map((record) => record.branch_id).filter((value): value is string => !!value))
    );

    branchIds.forEach((branchId) => {
      const branchRecords = projectRecords.filter((record) => record.branch_id === branchId);
      const firstRecord = branchRecords[0];
      if (!firstRecord) return;

      const parentBranchId =
        firstRecord.parent_id && nodes[firstRecord.parent_id]
          ? nodes[firstRecord.parent_id].branch_id
          : null;

      const branch: Branch = {
        branch_id: branchId,
        project_id: projectId,
        anchor_node_id: firstRecord.parent_id || rootNodeId || firstRecord.message_id,
        parent_branch_id: parentBranchId,
        status: 'active',
      };

      branches[branchId] = branch;
      naturalBranches[branchId] = branch;
    });
  }

  return {
    projects,
    nodes,
    branches,
    mainlines,
    contexts,
    naturalMainlines,
    naturalBranches,
    patterns: {},
    pastStructureSnapshots: [],
    futureStructureSnapshots: [],
    activeProjectId: Object.keys(projects)[0] || null,
  };
};

export const mergeRecoveredChatState = (
  currentState: RecoveredChatState,
  recoveredState: RecoveredChatState
): RecoveredChatState => {
  const mergedProjects = { ...recoveredState.projects, ...currentState.projects };
  const mergedNodes = { ...recoveredState.nodes, ...currentState.nodes };
  const mergedBranches = { ...recoveredState.branches, ...currentState.branches };
  const mergedNaturalBranches = { ...recoveredState.naturalBranches, ...currentState.naturalBranches };
  const mergedContexts = { ...recoveredState.contexts, ...currentState.contexts };

  const mergedMainlines = { ...recoveredState.mainlines };
  Object.entries(currentState.mainlines).forEach(([projectId, ids]) => {
    mergedMainlines[projectId] = ids.length > 0 ? ids : (mergedMainlines[projectId] || []);
  });

  const mergedNaturalMainlines = { ...recoveredState.naturalMainlines };
  Object.entries(currentState.naturalMainlines).forEach(([projectId, ids]) => {
    mergedNaturalMainlines[projectId] = ids.length > 0 ? ids : (mergedNaturalMainlines[projectId] || []);
  });

  return {
    projects: mergedProjects,
    nodes: mergedNodes,
    branches: mergedBranches,
    mainlines: mergedMainlines,
    contexts: mergedContexts,
    naturalMainlines: mergedNaturalMainlines,
    naturalBranches: mergedNaturalBranches,
    patterns: currentState.patterns,
    pastStructureSnapshots: [],
    futureStructureSnapshots: [],
    activeProjectId: currentState.activeProjectId || recoveredState.activeProjectId,
  };
};

export const pullRemoteChatHistory = async (): Promise<ChatHistoryRecord[]> => {
  const config = getSupabaseConfig();
  const userId = normalizeUserId();
  if (!config || !userId || !hasWindow()) return [];

  writeSyncState({
    last_pull_attempt_at: new Date().toISOString(),
  });

  try {
    const endpoint = new URL(`${config.url}/rest/v1/${SUPABASE_TABLE}`);
    endpoint.searchParams.set('select', '*');
    endpoint.searchParams.set('user_id', `eq.${userId}`);
    endpoint.searchParams.set('order', 'message_timestamp.asc');

    const response = await fetch(endpoint.toString(), {
      method: 'GET',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
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

    const records = (await response.json().catch(() => [])) as ChatHistoryRecord[];
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
      const makeRequest = (payload: ChatHistoryRecord[]) =>
        fetch(endpoint, {
          method: 'POST',
          headers: {
            apikey: config.anonKey,
            Authorization: `Bearer ${config.anonKey}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=ignore-duplicates,return=minimal',
          },
          body: JSON.stringify(payload),
        });

      const stripProjectTitle = (payload: ChatHistoryRecord[]): ChatHistoryRecord[] =>
        payload.map(({ project_title: _projectTitle, ...record }) => record);

      const usesProjectTitle =
        supportsRemoteProjectTitle !== false && batch.some((record) => record.project_title !== undefined);

      let body = '';
      let response = await makeRequest(
        supportsRemoteProjectTitle === false ? stripProjectTitle(batch) : batch
      );
      if (!response.ok) {
        body = await response.text().catch(() => '');
        const isMissingProjectTitleColumn =
          usesProjectTitle &&
          body.toLowerCase().includes('project_title') &&
          (body.toLowerCase().includes('column') || body.toLowerCase().includes('schema cache'));

        if (isMissingProjectTitleColumn) {
          supportsRemoteProjectTitle = false;
          response = await makeRequest(stripProjectTitle(batch));
          if (response.ok) {
            body = '';
          } else {
            body = await response.text().catch(() => '');
          }
        }
      }

      if (!response.ok) {
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

      if (supportsRemoteProjectTitle === null && usesProjectTitle) {
        supportsRemoteProjectTitle = true;
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

export const logChatNode = async (node: Node, options?: { projectTitle?: string | null }) => {
  const userId = normalizeUserId();
  if (!userId) return;

  const record: ChatHistoryRecord = {
    message_id: node.node_id,
    user_id: userId,
    project_id: node.project_id,
    project_title: options?.projectTitle?.trim() || null,
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
