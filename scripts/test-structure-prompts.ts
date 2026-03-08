import assert from 'node:assert/strict';
import {
  buildConversationSystemPrompt,
  buildStructureSuggestionSystemPrompt,
} from '../src/utils/promptBuilders';

const run = () => {
  const structurePrompt = buildStructureSuggestionSystemPrompt('Current mode: branch.');
  assert.match(
    structurePrompt,
    /If the user explicitly asks for a structural action, prioritize that stated intent/i
  );
  assert.match(
    structurePrompt,
    /The user may explicitly ask for more than one structural action at once/i
  );

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
