import assert from 'node:assert/strict';
import {
  createBranchFeedbackSyncRuntime,
  mergeRemoteBranchFeedbackDataset,
  type BranchFeedbackSyncRecord,
} from '../src/utils/branchFeedbackDataset';

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

const baseRecord: BranchFeedbackSyncRecord = {
  sample_id: 'sample-1',
  user_id: 'user-1',
  current_tldr: 'Launch planning branch',
  visible_context: [
    { user: 'What should we ship first?', assistant: 'Start with onboarding.' },
    { user: 'Can we compare variants?', assistant: 'Yes, compare activation and retention.' },
  ],
  history_last_3_qa: [
    { user: 'What should we ship first?', assistant: 'Start with onboarding.' },
  ],
  current_node: {
    user: 'Compare onboarding variants',
    assistant: 'Branching could keep experiments separate.',
  },
  level: 2,
  user_behaviour: 'branch',
  behaviour_source: 'accept_branch',
  time: '2026-03-11T15:00:00.000Z',
  captured_at: '2026-03-11T15:00:01.000Z',
};

const run = async () => {
  const storage = new MemoryStorage();
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  const runtime = createBranchFeedbackSyncRuntime({
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

  runtime.appendSample({
    current_tldr: baseRecord.current_tldr,
    visible_context: baseRecord.visible_context,
    history_last_3_qa: baseRecord.history_last_3_qa,
    current_node: baseRecord.current_node,
    level: baseRecord.level,
    user_behaviour: baseRecord.user_behaviour,
    behaviour_source: baseRecord.behaviour_source,
    time: baseRecord.time,
  });

  const localDataset = runtime.readLocalDatasetByUser('user-1');
  assert.equal(localDataset.should_branch.length, 1);
  assert.equal(localDataset.should_branch[0]?.behaviour_source, 'accept_branch');
  assert.ok(localDataset.should_branch[0]?.sample_id, 'new local samples should get a stable sample_id');
  assert.equal(localDataset.should_branch[0]?.visible_context?.length, 2);

  let syncState = runtime.readSyncState();
  assert.equal(syncState.pending_count, 1);

  await runtime.flushPending();

  assert.equal(fetchCalls.length, 1);
  const firstBatch = JSON.parse(String(fetchCalls[0]?.init?.body)) as BranchFeedbackSyncRecord[];
  assert.equal(firstBatch.length, 1);
  assert.equal(firstBatch[0]?.user_id, 'user-1');
  assert.equal(firstBatch[0]?.behaviour_source, 'accept_branch');
  assert.ok(firstBatch[0]?.sample_id);
  assert.equal(firstBatch[0]?.visible_context?.length, 2);

  syncState = runtime.readSyncState();
  assert.equal(syncState.pending_count, 0);
  assert.ok(syncState.last_success_at);

  const remoteFetchRuntime = createBranchFeedbackSyncRuntime({
    storage,
    getEnv: () => ({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
    }),
    fetchImpl: async () =>
      new Response(
        JSON.stringify([
          firstBatch[0],
          {
            ...baseRecord,
            sample_id: 'sample-2',
            user_behaviour: 'same_thread',
            behaviour_source: 'reject_branch',
            time: '2026-03-11T15:05:00.000Z',
            captured_at: '2026-03-11T15:05:01.000Z',
          },
        ] satisfies BranchFeedbackSyncRecord[]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ),
    getUserId: () => 'user-1',
  });

  const remoteRecords = await remoteFetchRuntime.pullRemoteBranchFeedback();
  assert.equal(remoteRecords.length, 2);

  const merged = mergeRemoteBranchFeedbackDataset(localDataset, remoteRecords);
  assert.equal(merged.should_branch.length, 1, 'merge should dedupe remote copies of the same local sample');
  assert.equal(merged.should_not_branch.length, 1, 'merge should append new remote negative samples');
  assert.equal(merged.should_not_branch[0]?.behaviour_source, 'reject_branch');

  console.log('Branch feedback sync tests passed.');
};

void run();
