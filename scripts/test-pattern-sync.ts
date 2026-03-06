import assert from 'node:assert/strict';
import { createPatternSyncRuntime, mergeRemotePatternsIntoPatterns, type PatternSyncRecord } from '../src/services/patternSync';
import type { Pattern } from '../src/types';

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

const pattern: Pattern = {
  pattern_id: 'pattern-1',
  type: 'reasoning',
  name: 'Keep context tight',
  requires_human_review: false,
  instruction: 'Summarize branch intent before responding.',
  example: 'State the active branch goal in one line.',
  review_status: 'approved',
  source_line: {
    from: 'node-1',
    to: 'node-2',
  },
  created_at: '2026-03-06T10:00:00.000Z',
  updated_at: '2026-03-06T10:00:00.000Z',
  created_from_project_id: 'project-1',
};

const run = async () => {
  const storage = new MemoryStorage();
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  const runtime = createPatternSyncRuntime({
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

  runtime.logPatternUpsert(pattern);

  const localHistory = runtime.readLocalPatternHistory();
  assert.equal(localHistory['user-1'].length, 1);
  assert.equal(localHistory['user-1'][0]?.pattern_id, 'pattern-1');
  assert.equal(localHistory['user-1'][0]?.is_deleted, false);

  let syncState = runtime.readSyncState();
  assert.equal(syncState.pending_count, 1);

  await runtime.flushPending();

  assert.equal(fetchCalls.length, 1);
  const firstBatch = JSON.parse(String(fetchCalls[0]?.init?.body)) as PatternSyncRecord[];
  assert.equal(firstBatch.length, 1);
  assert.equal(firstBatch[0]?.pattern_id, 'pattern-1');
  assert.equal(firstBatch[0]?.is_deleted, false);

  syncState = runtime.readSyncState();
  assert.equal(syncState.pending_count, 0);
  assert.ok(syncState.last_success_at);

  runtime.logPatternDelete(pattern);
  await runtime.flushPending();

  assert.equal(fetchCalls.length, 2);
  const deleteBatch = JSON.parse(String(fetchCalls[1]?.init?.body)) as PatternSyncRecord[];
  assert.equal(deleteBatch.length, 1);
  assert.equal(deleteBatch[0]?.pattern_id, 'pattern-1');
  assert.equal(deleteBatch[0]?.is_deleted, true);

  const latestHistory = runtime.readLocalPatternHistory();
  assert.equal(latestHistory['user-1'].length, 2);
  assert.equal(latestHistory['user-1'][1]?.is_deleted, true);

  const remoteFetchRuntime = createPatternSyncRuntime({
    storage: new MemoryStorage(),
    getEnv: () => ({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
    }),
    fetchImpl: async () =>
      new Response(
        JSON.stringify([
          {
            ...firstBatch[0],
            updated_at: '2026-03-06T11:00:00.000Z',
            is_deleted: false,
          },
          {
            ...firstBatch[0],
            pattern_id: 'pattern-2',
            updated_at: '2026-03-06T11:30:00.000Z',
            is_deleted: true,
          },
        ] satisfies PatternSyncRecord[]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ),
    getUserId: () => 'user-1',
  });

  const remoteRecords = await remoteFetchRuntime.pullRemotePatterns();
  assert.equal(remoteRecords.length, 2);
  assert.equal(remoteRecords[0]?.pattern_id, 'pattern-1');

  const merged = mergeRemotePatternsIntoPatterns(
    {
      'pattern-1': pattern,
      'pattern-2': {
        ...pattern,
        pattern_id: 'pattern-2',
        updated_at: '2026-03-06T11:00:00.000Z',
      },
    },
    remoteRecords
  );

  assert.equal(merged['pattern-1']?.updated_at, '2026-03-06T11:00:00.000Z');
  assert.equal(merged['pattern-2'], undefined);

  console.log('Pattern sync tests passed.');
};

void run();
