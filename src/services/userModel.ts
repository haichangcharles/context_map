export type BehaviourSourceLike = 'manually_branch' | 'ignore_branch' | 'reject_branch' | 'accept_branch';
export type UserBehaviourLike = 'branch' | 'same_thread';

export type QAPairLike = {
  user: string;
  assistant: string;
};

export type BranchFeedbackLikeSample = {
  sample_id?: string;
  current_tldr: string;
  visible_context?: QAPairLike[];
  history_last_3_qa: QAPairLike[];
  current_node: QAPairLike;
  level: number;
  user_behaviour: UserBehaviourLike;
  behaviour_source: BehaviourSourceLike;
  time: string;
};

export type BranchFeedbackLikeDataset = {
  should_branch: BranchFeedbackLikeSample[];
  should_not_branch: BranchFeedbackLikeSample[];
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type UserModelByUser = Record<string, UserModel>;

export type EvidenceStrength = 'none' | 'low' | 'medium' | 'high';
export type UserModelLifecycleStage = 'cold_start' | 'learning' | 'ready';
export type ContextGranularityLabel = 'undetermined' | 'coarse' | 'balanced' | 'fine';
export type BranchTriggerStyleLabel = 'undetermined' | 'early' | 'balanced' | 'late';
export type ManualControlLabel = 'undetermined' | 'system_guided' | 'balanced' | 'manual';
export type ReturnTriggerStyleLabel = 'undetermined' | 'early' | 'balanced' | 'late';

export type UserModelExample = {
  scenario: string;
  rationale: string;
  source: BehaviourSourceLike;
  time: string;
};

export type UserModelDimension<TLabel extends string> = {
  label: TLabel;
  evidence_strength: EvidenceStrength;
  examples: UserModelExample[];
};

export type UserModel = {
  user_id: string;
  updated_at: string;
  lifecycle_stage: UserModelLifecycleStage;
  sample_count: number;
  context_granularity: UserModelDimension<ContextGranularityLabel>;
  branch_trigger_style: UserModelDimension<BranchTriggerStyleLabel>;
  manual_control_preference: UserModelDimension<ManualControlLabel>;
  return_trigger_style: UserModelDimension<ReturnTriggerStyleLabel>;
  notes: string;
};

export type UserModelSyncRecord = {
  user_id: string;
  updated_at: string;
  captured_at: string;
  lifecycle_stage: UserModelLifecycleStage;
  sample_count: number;
  model_json: UserModel;
};

export type UserModelSyncState = {
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

type UserModelSyncRuntimeOptions = {
  storage: StorageLike;
  getEnv: () => {
    supabaseUrl: string;
    supabaseAnonKey: string;
  };
  fetchImpl: typeof fetch;
  getUserId: () => string | null;
  onStatusUpdated?: () => void;
};

export const USER_MODEL_STORAGE_KEY = 'context-map.user-model.by-user.v1';
const USER_MODEL_FEATURE_KEY = 'context-map.user-model.enabled.v1';
const ACTIVE_USER_KEY = 'context-map.active-user-id';
const LOCAL_PENDING_SYNC_KEY = 'context-map.user-model.pending-sync.v1';
const LOCAL_SYNC_STATUS_KEY = 'context-map.user-model.sync-status.v1';
const SUPABASE_TABLE = 'user_models';
const FALLBACK_LOCAL_USER_ID = 'local-anonymous';

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

const evidenceStrengthFromCount = (count: number): EvidenceStrength => {
  if (count <= 0) return 'none';
  if (count === 1) return 'low';
  if (count <= 3) return 'medium';
  return 'high';
};

const lifecycleStageFromCount = (count: number): UserModelLifecycleStage => {
  if (count === 0) return 'cold_start';
  if (count < 5) return 'learning';
  return 'ready';
};

const truncate = (text: string, max = 120): string => text.replace(/\s+/g, ' ').trim().slice(0, max);

const examplePriority = (source: BehaviourSourceLike): number => {
  switch (source) {
    case 'manually_branch':
      return 0;
    case 'accept_branch':
      return 1;
    case 'reject_branch':
      return 2;
    case 'ignore_branch':
      return 3;
  }
};

const exampleRationale = (sample: BranchFeedbackLikeSample): string => {
  switch (sample.behaviour_source) {
    case 'manually_branch':
      return 'The user manually created a branch, which is evidence that the system likely missed a structural boundary.';
    case 'accept_branch':
      return 'The user accepted a branch suggestion, which supports the current branching boundary.';
    case 'reject_branch':
      return 'The user rejected a branch suggestion, which suggests the current thread still felt unified to them.';
    case 'ignore_branch':
      return 'The user ignored a branch suggestion, which is weaker evidence that the suggestion may have felt unnecessary or mistimed.';
  }
};

const buildExamples = (samples: BranchFeedbackLikeSample[]): UserModelExample[] =>
  [...samples]
    .sort((a, b) => {
      const byPriority = examplePriority(a.behaviour_source) - examplePriority(b.behaviour_source);
      if (byPriority !== 0) return byPriority;
      return new Date(b.time).getTime() - new Date(a.time).getTime();
    })
    .slice(0, 3)
    .map((sample) => ({
      scenario: truncate(sample.current_node.user || sample.current_tldr || 'No scenario captured.'),
      rationale: exampleRationale(sample),
      source: sample.behaviour_source,
      time: sample.time,
    }));

const buildDimension = <TLabel extends string>(
  label: TLabel,
  supportingSamples: BranchFeedbackLikeSample[]
): UserModelDimension<TLabel> => ({
  label,
  evidence_strength: evidenceStrengthFromCount(supportingSamples.length),
  examples: buildExamples(supportingSamples),
});

const inferContextGranularity = (samples: BranchFeedbackLikeSample[]): ContextGranularityLabel => {
  if (samples.length === 0) return 'undetermined';
  const score = samples.reduce((total, sample) => {
    switch (sample.behaviour_source) {
      case 'manually_branch':
        return total + 2;
      case 'accept_branch':
        return total + 1;
      case 'reject_branch':
        return total - 1;
      case 'ignore_branch':
        return total - 0.5;
    }
  }, 0);

  if (score >= 1.5) return 'fine';
  if (score <= -1) return 'coarse';
  return 'balanced';
};

const inferBranchTriggerStyle = (samples: BranchFeedbackLikeSample[]): BranchTriggerStyleLabel => {
  const positive = samples.filter((sample) => sample.user_behaviour === 'branch');
  if (positive.length === 0) return 'undetermined';
  const averageLevel = positive.reduce((sum, sample) => sum + sample.level, 0) / positive.length;
  if (averageLevel <= 1.5) return 'early';
  if (averageLevel >= 3) return 'late';
  return 'balanced';
};

const inferManualControlPreference = (samples: BranchFeedbackLikeSample[]): ManualControlLabel => {
  const branchActions = samples.filter((sample) => sample.user_behaviour === 'branch');
  if (branchActions.length === 0) return 'undetermined';
  const manualCount = branchActions.filter((sample) => sample.behaviour_source === 'manually_branch').length;
  const manualRatio = manualCount / branchActions.length;
  if (manualRatio >= 0.65) return 'manual';
  if (manualRatio <= 0.2) return 'system_guided';
  return 'balanced';
};

const inferReturnTriggerStyle = (): ReturnTriggerStyleLabel => 'undetermined';

const buildNotes = (sampleCount: number, lifecycleStage: UserModelLifecycleStage): string => {
  if (lifecycleStage === 'cold_start') {
    return 'No structural interaction evidence has been collected yet.';
  }
  if (lifecycleStage === 'learning') {
    return `The model is still learning from a small evidence set (${sampleCount} sample${sampleCount === 1 ? '' : 's'}).`;
  }
  return 'The model has enough structural interaction evidence to act as a shadow reference.';
};

const formatDimensionLine = <TLabel extends string>(
  title: string,
  dimension: UserModelDimension<TLabel>
): string => `${title}: ${dimension.label} (evidence: ${dimension.evidence_strength})`;

const formatExampleSource = (source: BehaviourSourceLike): string => source.replace(/_/g, ' ');

export const buildUserModelFromBranchFeedback = (
  userId: string,
  dataset: BranchFeedbackLikeDataset
): UserModel => {
  const shouldBranch = Array.isArray(dataset.should_branch) ? dataset.should_branch : [];
  const shouldNotBranch = Array.isArray(dataset.should_not_branch) ? dataset.should_not_branch : [];
  const all = [...shouldBranch, ...shouldNotBranch].sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
  );
  const sampleCount = all.length;
  const lifecycleStage = lifecycleStageFromCount(sampleCount);

  const contextGranularityLabel = inferContextGranularity(all);
  const branchTriggerStyleLabel = inferBranchTriggerStyle(all);
  const manualControlLabel = inferManualControlPreference(all);
  const returnTriggerStyleLabel = inferReturnTriggerStyle();

  const contextExamples = all.filter(
    (sample) =>
      sample.behaviour_source === 'manually_branch' ||
      sample.behaviour_source === 'accept_branch' ||
      sample.behaviour_source === 'reject_branch' ||
      sample.behaviour_source === 'ignore_branch'
  );
  const branchTimingExamples = all.filter((sample) => sample.user_behaviour === 'branch');
  const manualControlExamples = all.filter(
    (sample) =>
      sample.behaviour_source === 'manually_branch' ||
      sample.behaviour_source === 'accept_branch'
  );

  return {
    user_id: userId,
    updated_at: new Date().toISOString(),
    lifecycle_stage: lifecycleStage,
    sample_count: sampleCount,
    context_granularity: buildDimension(contextGranularityLabel, contextExamples),
    branch_trigger_style: buildDimension(branchTriggerStyleLabel, branchTimingExamples),
    manual_control_preference: buildDimension(manualControlLabel, manualControlExamples),
    return_trigger_style: buildDimension(returnTriggerStyleLabel, []),
    notes: buildNotes(sampleCount, lifecycleStage),
  };
};

export const readAllUserModelsFromStorage = (storage: StorageLike): Record<string, UserModel> =>
  readJson<Record<string, UserModel>>(storage, USER_MODEL_STORAGE_KEY, {});

const toSyncRecord = (model: UserModel): UserModelSyncRecord => ({
  user_id: model.user_id,
  updated_at: model.updated_at,
  captured_at: new Date().toISOString(),
  lifecycle_stage: model.lifecycle_stage,
  sample_count: model.sample_count,
  model_json: model,
});

const writeUserModelToStorage = (storage: StorageLike, model: UserModel) => {
  const next = readAllUserModelsFromStorage(storage);
  next[model.user_id] = model;
  writeJson(storage, USER_MODEL_STORAGE_KEY, next);
};

const readPendingQueue = (storage: StorageLike): UserModelSyncRecord[] =>
  readJson<UserModelSyncRecord[]>(storage, LOCAL_PENDING_SYNC_KEY, []);

const writePendingQueue = (storage: StorageLike, queue: UserModelSyncRecord[]) => {
  writeJson(storage, LOCAL_PENDING_SYNC_KEY, queue);
};

const readSyncStateFromStorage = (storage: StorageLike): UserModelSyncState =>
  readJson<UserModelSyncState>(storage, LOCAL_SYNC_STATUS_KEY, {
    last_attempt_at: null,
    last_success_at: null,
    last_error_at: null,
    last_error_message: null,
    pending_count: readPendingQueue(storage).length,
    last_pull_attempt_at: null,
    last_pull_success_at: null,
    last_pull_error_at: null,
    last_pull_error_message: null,
  });

const writeSyncStateToStorage = (storage: StorageLike, patch: Partial<UserModelSyncState>) => {
  const next = {
    ...readSyncStateFromStorage(storage),
    ...patch,
  };
  writeJson(storage, LOCAL_SYNC_STATUS_KEY, next);
};

const upsertPendingSyncRecord = (storage: StorageLike, record: UserModelSyncRecord) => {
  const queue = readPendingQueue(storage);
  const index = queue.findIndex((item) => item.user_id === record.user_id);
  if (index >= 0) {
    queue[index] = record;
  } else {
    queue.push(record);
  }
  writePendingQueue(storage, queue);
  writeSyncStateToStorage(storage, { pending_count: queue.length });
};

export const saveUserModelToStorage = (storage: StorageLike, model: UserModel) => {
  writeUserModelToStorage(storage, model);
  upsertPendingSyncRecord(storage, toSyncRecord(model));
};

export const readUserModelByUserFromStorage = (storage: StorageLike, userId: string): UserModel | null =>
  readAllUserModelsFromStorage(storage)[userId] || null;

export const refreshUserModelInStorage = (
  storage: StorageLike,
  userId: string,
  dataset: BranchFeedbackLikeDataset
): UserModel => {
  const model = buildUserModelFromBranchFeedback(userId, dataset);
  saveUserModelToStorage(storage, model);
  return model;
};

const toEpoch = (value: string | null | undefined): number => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const mergeRemoteUserModelsIntoLocal = (
  localByUser: UserModelByUser,
  remoteRecords: UserModelSyncRecord[]
): UserModelByUser => {
  const next = { ...localByUser };

  remoteRecords.forEach((record) => {
    const existing = next[record.user_id];
    if (existing && toEpoch(existing.updated_at) > toEpoch(record.updated_at)) {
      return;
    }
    next[record.user_id] = record.model_json;
  });

  return next;
};

export const createUserModelSyncRuntime = ({
  storage,
  getEnv,
  fetchImpl,
  getUserId,
  onStatusUpdated,
}: UserModelSyncRuntimeOptions) => {
  let flushPromise: Promise<void> | null = null;

  const emitStatusUpdated = () => {
    onStatusUpdated?.();
  };

  const writeSyncState = (patch: Partial<UserModelSyncState>) => {
    writeSyncStateToStorage(storage, patch);
    emitStatusUpdated();
  };

  const readSyncState = (): UserModelSyncState => readSyncStateFromStorage(storage);

  const flushPendingInternal = async () => {
    const { supabaseUrl, supabaseAnonKey } = getEnv();
    if (!supabaseUrl || !supabaseAnonKey) return;

    let queue = readPendingQueue(storage);
    if (queue.length === 0) return;

    writeSyncState({
      last_attempt_at: new Date().toISOString(),
      pending_count: queue.length,
    });

    const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${SUPABASE_TABLE}?on_conflict=user_id`;
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
      writePendingQueue(storage, queue);
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

  const pullRemoteUserModels = async (): Promise<UserModelSyncRecord[]> => {
    const { supabaseUrl, supabaseAnonKey } = getEnv();
    const userId = (getUserId()?.trim() || '') || FALLBACK_LOCAL_USER_ID;
    if (!supabaseUrl || !supabaseAnonKey || !userId) return [];

    writeSyncState({
      last_pull_attempt_at: new Date().toISOString(),
    });

    try {
      const endpoint = new URL(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${SUPABASE_TABLE}`);
      endpoint.searchParams.set('select', '*');
      endpoint.searchParams.set('user_id', `eq.${userId}`);

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

      const records = (await response.json().catch(() => [])) as UserModelSyncRecord[];
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

  const mergeRemoteRecordsIntoLocal = (userId: string, remoteRecords: UserModelSyncRecord[]) => {
    const merged = mergeRemoteUserModelsIntoLocal(readAllUserModelsFromStorage(storage), remoteRecords);
    if (merged[userId]) {
      writeUserModelToStorage(storage, merged[userId]);
    } else {
      writeJson(storage, USER_MODEL_STORAGE_KEY, merged);
    }
    return merged;
  };

  return {
    flushPending,
    pullRemoteUserModels,
    mergeRemoteRecordsIntoLocal,
    readSyncState,
  };
};

export const readAllUserModels = (): Record<string, UserModel> => {
  if (!hasWindow()) return {};
  return readAllUserModelsFromStorage(window.localStorage);
};

export const readUserModel = (userId: string): UserModel | null => {
  if (!hasWindow()) return null;
  return readUserModelByUserFromStorage(window.localStorage, userId);
};

export const saveUserModel = (model: UserModel) => {
  if (!hasWindow()) return;
  saveUserModelToStorage(window.localStorage, model);
};

const defaultRuntime = (() => {
  if (!hasWindow()) return null;

  return createUserModelSyncRuntime({
    storage: window.localStorage,
    getEnv: () => ({
      supabaseUrl: ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_URL || '').trim(),
      supabaseAnonKey: ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_ANON_KEY || '').trim(),
    }),
    fetchImpl: fetch,
    getUserId: () => {
      const raw = window.localStorage.getItem(ACTIVE_USER_KEY);
      return (raw || '').trim() || null;
    },
    onStatusUpdated: () => {
      window.dispatchEvent(new CustomEvent('user-model-sync-updated'));
    },
  });
})();

export const flushUserModelSyncQueue = async () => {
  if (!defaultRuntime) return;
  await defaultRuntime.flushPending();
};

export const pullRemoteUserModels = async (): Promise<UserModelSyncRecord[]> => {
  if (!defaultRuntime) return [];
  return defaultRuntime.pullRemoteUserModels();
};

export const mergeUserModelsFromRemoteRecords = (records: UserModelSyncRecord[]) => {
  if (!hasWindow()) return;
  const rawUserId = window.localStorage.getItem(ACTIVE_USER_KEY);
  const userId = (rawUserId || '').trim() || FALLBACK_LOCAL_USER_ID;
  defaultRuntime?.mergeRemoteRecordsIntoLocal(userId, records);
};

export const startUserModelSync = () => {
  if (!hasWindow() || !defaultRuntime) return () => {};

  const onOnline = () => {
    void flushUserModelSyncQueue();
  };

  const onVisible = () => {
    if (typeof document !== 'undefined' && !document.hidden) {
      void flushUserModelSyncQueue();
    }
  };

  window.addEventListener('online', onOnline);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
  }

  const timer = window.setInterval(() => {
    void flushUserModelSyncQueue();
  }, 15000);

  void flushUserModelSyncQueue();

  return () => {
    window.removeEventListener('online', onOnline);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisible);
    }
    window.clearInterval(timer);
  };
};

export const readUserModelSyncState = (): UserModelSyncState =>
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

export const formatUserModelForBranchAgent = (userModel: UserModel): string => {
  const exampleLines = userModel.context_granularity.examples
    .slice(0, 3)
    .map((example, index) => `${index + 1}. ${example.scenario} [source: ${formatExampleSource(example.source)}]`);

  const lines = [
    'User Structuring Model',
    `Lifecycle stage: ${userModel.lifecycle_stage}`,
    `Sample count: ${userModel.sample_count}`,
    formatDimensionLine('Context granularity', userModel.context_granularity),
    formatDimensionLine('Branch trigger style', userModel.branch_trigger_style),
    formatDimensionLine('Manual control preference', userModel.manual_control_preference),
    formatDimensionLine('Return trigger style', userModel.return_trigger_style),
    `Notes: ${userModel.notes}`,
    exampleLines.length > 0 ? 'Representative examples:' : 'Representative examples: none yet.',
    ...exampleLines,
    'Use this as advisory guidance, not as an authoritative rule.',
  ];

  return lines.join('\n');
};

export const formatUserModelForStructureAgent = (userModel: UserModel): string =>
  JSON.stringify(userModel, null, 2);

export const getUserModelFeatureEnabledFromStorage = (storage: StorageLike): boolean => {
  const raw = storage.getItem(USER_MODEL_FEATURE_KEY);
  if (raw === null) return true;
  return raw === '1';
};

export const setUserModelFeatureEnabledInStorage = (storage: StorageLike, enabled: boolean) => {
  try {
    storage.setItem(USER_MODEL_FEATURE_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore storage errors.
  }
};

export const getUserModelFeatureEnabled = (): boolean => {
  if (!hasWindow()) return true;
  return getUserModelFeatureEnabledFromStorage(window.localStorage);
};

export const setUserModelFeatureEnabled = (enabled: boolean) => {
  if (!hasWindow()) return;
  setUserModelFeatureEnabledInStorage(window.localStorage, enabled);
};

export const buildUserModelAgentSystemPrompt = (): string => `You are the User Model Agent for a multi-threaded conversation system.

Project background:
This system helps users manage complex conversations by supporting structural actions such as:
- opening a new branch for a side path or subproblem
- returning from a branch to a parent thread or mainline
- extracting reusable content from a conversation

Why this user model exists:
The goal of this user model is not to create a generic personality profile.
The goal is to help structure-related agents better understand how this specific user prefers conversational context to be segmented, continued, revisited, or extracted.

Who this user model is for:
This user model is created for the Structure Agent.

What the Structure Agent does:
The Structure Agent is responsible for making structural decisions in the conversation system. Its job is to decide:
- whether the current turn should continue in the current thread
- whether the current turn should open a new branch
- whether the conversation should return to a parent thread or mainline
- whether the current conversation has become suitable for extraction

Why this matters:
The Structure Agent should not rely only on general structural heuristics.
It should also understand how this specific user tends to perceive context boundaries, thread continuity, branching moments, return timing, and extraction readiness.

Your user model will be used as advisory guidance for the Structure Agent so that its structural decisions better align with the user's own way of organizing conversation.

Your job is to maintain a reusable User Model that captures how this user prefers conversational structure to be organized.

You do NOT decide whether the system should branch, return, or extract in the current moment.
You only update the user model so that other structure agents can use it as advisory guidance.

Your goal is to infer:
- when this user tends to prefer opening a new branch
- when this user tends to prefer returning to a parent thread
- when this user tends to prefer extraction
- how this user interprets context boundaries and thread granularity

You must produce a model that is:
- compact
- reusable
- generalizable
- grounded in the provided interaction evidence

Do not simply restate specific cases.
Do not produce overly abstract claims that are unsupported by the evidence.
Generalizations must be reusable across future situations.

Each supporting example must preserve enough compressed context to explain why the structural event mattered.
Include the recent few QA pairs when they are available, but keep them compressed and selective rather than verbose.

Interpretation rules:
- manual structural actions are especially important evidence because they may indicate the system missed a structural boundary the user expected
- reject and ignore are not identical; reject is usually stronger evidence than ignore
- examples must include enough context to preserve why the event matters
- generalized interpretations must be about the user's reusable structuring preferences, not about one isolated topic

Cold start rules:
- if evidence is weak or insufficient, say so
- do not overstate certainty
- use lifecycle stages such as cold_start, learning, ready
- leave labels undetermined when needed

Update rules:
- keep only a small number of the most representative supporting examples
- replace an old example only if the new one is more representative or adds missing coverage
- preserve stable generalizations unless new evidence meaningfully changes them
- evidence_strength reflects how well-supported a conclusion is, not a probability of user behavior

You must output strict JSON only.`;
