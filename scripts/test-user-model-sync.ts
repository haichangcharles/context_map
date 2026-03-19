import assert from 'node:assert/strict';
import {
  buildUserModelFromBranchFeedback,
  createUserModelSyncRuntime,
  mergeRemoteUserModelsIntoLocal,
  readAllUserModelsFromStorage,
  refreshUserModelInStorage,
  type UserModelSyncRecord,
} from '../src/services/userModel';

class MemoryStorage {
  private store = new Map<string, string>();

  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }
}

const dataset = {
  should_branch: [
    {
      current_tldr: 'The user manually split off a side exploration.',
      history_last_3_qa: [{ user: 'Debug the current path', assistant: 'Try tightening the current flow.' }],
      current_node: {
        user: 'Let us explore the optional side path separately.',
        assistant: 'That may deserve its own branch.',
      },
      level: 2,
      user_behaviour: 'branch' as const,
      behaviour_source: 'manually_branch' as const,
      time: '2026-03-19T15:00:00.000Z',
    },
  ],
  should_not_branch: [],
};

const run = async () => {
  const storage = new MemoryStorage();
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  const runtime = createUserModelSyncRuntime({
    storage,
    getEnv: () => ({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
    }),
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url: String(url), init });
      return new Response('', { status: 201 });
    },
    getUserId: () => 'user-1',
  });

  const localModel = refreshUserModelInStorage(storage, 'user-1', dataset);
  assert.equal(localModel.user_id, 'user-1');
  assert.equal(runtime.readSyncState().pending_count, 1, 'refreshing the local user model should enqueue it for sync');

  await runtime.flushPending();
  assert.equal(fetchCalls.length, 1);
  const firstBatch = JSON.parse(String(fetchCalls[0]?.init?.body)) as UserModelSyncRecord[];
  assert.equal(firstBatch.length, 1);
  assert.equal(firstBatch[0]?.user_id, 'user-1');
  assert.equal(firstBatch[0]?.model_json.context_granularity.label, 'fine');
  assert.equal(runtime.readSyncState().pending_count, 0);

  const remoteModel = buildUserModelFromBranchFeedback('user-1', {
    should_branch: dataset.should_branch,
    should_not_branch: [
      {
        current_tldr: 'The user rejected a branch to stay in the same thread.',
        history_last_3_qa: [{ user: 'Keep comparing in one thread', assistant: 'Continue the same comparison.' }],
        current_node: {
          user: 'Keep refining the same comparison here.',
          assistant: 'This still fits the same local objective.',
        },
        level: 2,
        user_behaviour: 'same_thread' as const,
        behaviour_source: 'reject_branch' as const,
        time: '2026-03-19T16:00:00.000Z',
      },
    ],
  });
  const remoteRecord: UserModelSyncRecord = {
    user_id: 'user-1',
    updated_at: remoteModel.updated_at,
    captured_at: '2026-03-19T16:00:01.000Z',
    lifecycle_stage: remoteModel.lifecycle_stage,
    sample_count: remoteModel.sample_count,
    model_json: remoteModel,
  };

  const merged = mergeRemoteUserModelsIntoLocal(readAllUserModelsFromStorage(storage), [remoteRecord]);
  assert.equal(merged['user-1']?.sample_count, 2);
  assert.equal(merged['user-1']?.context_granularity.label, 'balanced');

  console.log('User model sync tests passed.');
};

void run();
