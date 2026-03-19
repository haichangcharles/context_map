import assert from 'node:assert/strict';
import { createBranchFeedbackSyncRuntime, type BranchFeedbackDataset } from '../src/utils/branchFeedbackDataset';
import {
  USER_MODEL_STORAGE_KEY,
  buildUserModelFromBranchFeedback,
  buildUserModelAgentSystemPrompt,
  formatUserModelForBranchAgent,
  readUserModelByUserFromStorage,
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

const emptyDataset: BranchFeedbackDataset = {
  should_branch: [],
  should_not_branch: [],
};

const run = async () => {
  const coldStart = buildUserModelFromBranchFeedback('cold-user', emptyDataset);
  assert.equal(coldStart.lifecycle_stage, 'cold_start');
  assert.equal(coldStart.sample_count, 0);
  assert.equal(coldStart.context_granularity.label, 'undetermined');
  assert.equal(coldStart.context_granularity.evidence_strength, 'none');
  assert.equal(coldStart.context_granularity.examples.length, 0);
  assert.equal(coldStart.return_trigger_style.label, 'undetermined');

  const storage = new MemoryStorage();
  const runtime = createBranchFeedbackSyncRuntime({
    storage,
    getEnv: () => ({
      supabaseUrl: '',
      supabaseAnonKey: '',
    }),
    fetchImpl: async () => new Response('', { status: 200 }),
    getUserId: () => 'user-1',
  });

  runtime.appendSample({
    current_tldr: 'The user manually split off an implementation subtask.',
    visible_context: [
      { user: 'Can we also compare alternatives?', assistant: 'Yes, but it may be easier in a side branch.' },
    ],
    history_last_3_qa: [
      { user: 'Can we also compare alternatives?', assistant: 'Yes, but it may be easier in a side branch.' },
    ],
    current_node: {
      user: 'Now I want to investigate one optional path in detail.',
      assistant: 'That exploration may deserve a branch.',
    },
    level: 2,
    user_behaviour: 'branch',
    behaviour_source: 'manually_branch',
    time: '2026-03-18T14:00:00.000Z',
  });

  const persisted = readUserModelByUserFromStorage(storage, 'user-1');
  assert.ok(persisted, 'appending branch feedback should refresh the shadow user model');
  assert.equal(persisted?.user_id, 'user-1');
  assert.equal(persisted?.lifecycle_stage, 'learning');
  assert.equal(persisted?.context_granularity.label, 'fine');
  assert.notEqual(storage.getItem(USER_MODEL_STORAGE_KEY), null, 'shadow user model should be persisted to its own storage key');
  assert.equal(persisted?.context_granularity.examples.length, 1);
  assert.equal(persisted?.context_granularity.examples[0]?.source, 'manually_branch');

  const prompt = formatUserModelForBranchAgent(persisted!);
  assert.match(prompt, /User Structuring Model/);
  assert.match(prompt, /Use this as advisory guidance, not as an authoritative rule\./);
  assert.match(prompt, /Context granularity: fine \(evidence: low\)/);
  assert.match(prompt, /Representative examples:/);
  assert.match(prompt, /manually branch/i);
  assert.ok(prompt.split('\n').length <= 24, 'formatter should stay compact enough for prompt injection');

  const agentPrompt = buildUserModelAgentSystemPrompt();
  assert.match(agentPrompt, /This user model is created for the Structure Agent\./);
  assert.match(agentPrompt, /The Structure Agent is responsible for making structural decisions/i);
  assert.match(agentPrompt, /whether the current turn should continue in the current thread/i);
  assert.match(agentPrompt, /whether the current turn should open a new branch/i);
  assert.match(agentPrompt, /whether the conversation should return to a parent thread or mainline/i);
  assert.match(agentPrompt, /whether the current conversation has become suitable for extraction/i);

  console.log('User model tests passed.');
};

void run();
