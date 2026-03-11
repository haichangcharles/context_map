import assert from 'node:assert/strict';
import {
  createStructureSuggestionFeedbackRuntime,
  mergeRemoteStructureSuggestionFeedback,
  type StructureSuggestionFeedbackEvent,
} from '../src/services/structureSuggestionFeedback';

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

const baseEvent: StructureSuggestionFeedbackEvent = {
  event_id: 'event-1',
  suggestion_id: 'suggestion-1',
  user_id: 'user-1',
  project_id: 'project-1',
  base_path: 'branch-1',
  target_node_id: 'node-2',
  suggestion_kind: 'return_parent',
  origin_kind: 'structure',
  decision: 'shown',
  current_tldr: 'Evaluate launch branch',
  history_last_3_qa: [
    { user: 'What about pricing?', assistant: 'We should compare tiers.' },
  ],
  current_node: {
    user: 'Summarize the branch outcome',
    assistant: 'A return to parent may be timely.',
  },
  suggestion_payload: {
    reason: 'This branch looks complete.',
    assetAction: 'none',
  },
  shown_at: '2026-03-11T16:05:00.000Z',
  decided_at: null,
  captured_at: '2026-03-11T16:05:01.000Z',
};

const run = async () => {
  const storage = new MemoryStorage();
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  const runtime = createStructureSuggestionFeedbackRuntime({
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

  runtime.logEvent({
    suggestion_id: baseEvent.suggestion_id,
    project_id: baseEvent.project_id,
    base_path: baseEvent.base_path,
    target_node_id: baseEvent.target_node_id,
    suggestion_kind: baseEvent.suggestion_kind,
    origin_kind: baseEvent.origin_kind,
    decision: baseEvent.decision,
    current_tldr: baseEvent.current_tldr,
    history_last_3_qa: baseEvent.history_last_3_qa,
    current_node: baseEvent.current_node,
    suggestion_payload: baseEvent.suggestion_payload,
    shown_at: baseEvent.shown_at,
    decided_at: baseEvent.decided_at,
  });

  const localHistory = runtime.readLocalHistoryByUser('user-1');
  assert.equal(localHistory.length, 1);
  assert.equal(localHistory[0]?.suggestion_kind, 'return_parent');
  assert.equal(localHistory[0]?.decision, 'shown');
  assert.ok(localHistory[0]?.event_id);

  let syncState = runtime.readSyncState();
  assert.equal(syncState.pending_count, 1);

  await runtime.flushPending();

  assert.equal(fetchCalls.length, 1);
  const firstBatch = JSON.parse(String(fetchCalls[0]?.init?.body)) as StructureSuggestionFeedbackEvent[];
  assert.equal(firstBatch.length, 1);
  assert.equal(firstBatch[0]?.suggestion_kind, 'return_parent');
  assert.equal(firstBatch[0]?.decision, 'shown');

  runtime.logEvent({
    suggestion_id: baseEvent.suggestion_id,
    project_id: baseEvent.project_id,
    base_path: baseEvent.base_path,
    target_node_id: baseEvent.target_node_id,
    suggestion_kind: baseEvent.suggestion_kind,
    origin_kind: baseEvent.origin_kind,
    decision: 'accepted',
    current_tldr: baseEvent.current_tldr,
    history_last_3_qa: baseEvent.history_last_3_qa,
    current_node: baseEvent.current_node,
    suggestion_payload: baseEvent.suggestion_payload,
    shown_at: baseEvent.shown_at,
    decided_at: '2026-03-11T16:05:10.000Z',
  });

  await runtime.flushPending();

  assert.equal(fetchCalls.length, 2);
  const secondBatch = JSON.parse(String(fetchCalls[1]?.init?.body)) as StructureSuggestionFeedbackEvent[];
  assert.equal(secondBatch.length, 1);
  assert.equal(secondBatch[0]?.decision, 'accepted');

  syncState = runtime.readSyncState();
  assert.equal(syncState.pending_count, 0);
  assert.ok(syncState.last_success_at);

  const remoteRuntime = createStructureSuggestionFeedbackRuntime({
    storage: new MemoryStorage(),
    getEnv: () => ({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
    }),
    fetchImpl: async () =>
      new Response(
        JSON.stringify([
          firstBatch[0],
          secondBatch[0],
          {
            ...baseEvent,
            event_id: 'event-3',
            suggestion_id: 'suggestion-2',
            suggestion_kind: 'extract_reasoning',
            origin_kind: 'branch_extract',
            decision: 'rejected',
            shown_at: '2026-03-11T16:06:00.000Z',
            decided_at: '2026-03-11T16:06:05.000Z',
            captured_at: '2026-03-11T16:06:06.000Z',
          },
        ] satisfies StructureSuggestionFeedbackEvent[]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ),
    getUserId: () => 'user-1',
  });

  const remoteEvents = await remoteRuntime.pullRemoteEvents();
  assert.equal(remoteEvents.length, 3);

  const merged = mergeRemoteStructureSuggestionFeedback(localHistory, remoteEvents);
  assert.equal(merged.length, 3, 'merge should dedupe identical local/remote events by event_id');
  assert.equal(merged[2]?.suggestion_kind, 'extract_reasoning');
  assert.equal(merged[2]?.origin_kind, 'branch_extract');

  console.log('Structure suggestion feedback sync tests passed.');
};

void run();
