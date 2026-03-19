import assert from 'node:assert/strict';
import {
  buildConversationSystemPrompt,
  buildStructureSuggestionSystemPrompt,
} from '../src/utils/promptBuilders';
import {
  buildUserModelFromBranchFeedback,
  formatUserModelForStructureAgent,
  getUserModelFeatureEnabledFromStorage,
  setUserModelFeatureEnabledInStorage,
} from '../src/services/userModel';

const run = () => {
  const structurePrompt = buildStructureSuggestionSystemPrompt({ contextLines: 'Current mode: branch.' });
  assert.match(
    structurePrompt,
    /If the user explicitly asks for a structural action, prioritize that stated intent/i
  );
  assert.match(
    structurePrompt,
    /The user may explicitly ask for more than one structural action at once/i
  );

  const userModel = buildUserModelFromBranchFeedback('user-1', {
    should_branch: [
      {
        current_tldr: 'Manual branch for an optional detour.',
        history_last_3_qa: [{ user: 'Debug this path', assistant: 'Try this fix.' }],
        current_node: {
          user: 'Let us explore one optional path separately.',
          assistant: 'That may deserve a separate branch.',
        },
        level: 2,
        user_behaviour: 'branch',
        behaviour_source: 'manually_branch',
        time: '2026-03-19T12:00:00.000Z',
      },
    ],
    should_not_branch: [],
  });
  const userModelBlock = formatUserModelForStructureAgent(userModel);
  const injectedPrompt = buildStructureSuggestionSystemPrompt({
    contextLines: 'Current mode: branch.',
    userModelBlock,
  });
  assert.match(injectedPrompt, /User model guidance:/);
  assert.match(injectedPrompt, /This full user model is advisory guidance for the Structure Agent\./);
  assert.match(injectedPrompt, /"context_granularity"/);

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

  const storage = new MemoryStorage();
  assert.equal(getUserModelFeatureEnabledFromStorage(storage), true);
  setUserModelFeatureEnabledInStorage(storage, false);
  assert.equal(getUserModelFeatureEnabledFromStorage(storage), false);
  setUserModelFeatureEnabledInStorage(storage, true);
  assert.equal(getUserModelFeatureEnabledFromStorage(storage), true);

  const mainlinePrompt = buildConversationSystemPrompt({
    isMainline: true,
    branchAnchorNodeId: null,
    mainlineSummary: '',
  });
  assert.match(
    mainlinePrompt,
    /There is also a separate structure agent in the system/i
  );
  assert.match(
    mainlinePrompt,
    /If the user mentions opening a branch, returning to a parent, or extracting a pattern/i
  );
  assert.match(
    mainlinePrompt,
    /briefly acknowledge that the structure agent\/subagent will handle them/i
  );
  assert.match(
    mainlinePrompt,
    /Do not invent normal task content, domain explanations, or fake SOPs/i
  );

  const branchPrompt = buildConversationSystemPrompt({
    isMainline: false,
    branchAnchorNodeId: 'anchor-1',
    mainlineSummary: 'Main task summary here',
  });
  assert.match(branchPrompt, /You are executing a Subtask branch/i);
  assert.match(branchPrompt, /Main task summary here/);

  console.log('Structure prompt tests passed.');
};

run();
