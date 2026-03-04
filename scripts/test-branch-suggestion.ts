import assert from 'node:assert/strict';
import { parseBranchSuggestionDecision, shouldOfferBranchSuggestion } from '../src/utils/branchSuggestion';

const run = () => {
  const positive = parseBranchSuggestionDecision(
    '{"should_branch":true,"confidence":0.92,"reason":"This is a temporary subtask."}'
  );
  assert.equal(positive.shouldBranch, true, 'positive case should suggest branch');
  assert.equal(shouldOfferBranchSuggestion(positive), true, 'positive case should be offered');

  const lowConfidence = parseBranchSuggestionDecision(
    '{"should_branch":true,"confidence":0.2,"reason":"Weak signal"}'
  );
  assert.equal(lowConfidence.shouldBranch, false, 'low confidence should not suggest branch');

  const negative = parseBranchSuggestionDecision(
    '{"should_branch":false,"confidence":0.95,"reason":"Still on main task"}'
  );
  assert.equal(negative.shouldBranch, false, 'negative case should not suggest branch');

  const malformed = parseBranchSuggestionDecision('not json');
  assert.equal(malformed.shouldBranch, false, 'malformed payload should fail closed');

  const fenced = parseBranchSuggestionDecision(
    '```json\n{"should_branch":true,"confidence":0.8,"reason":"Off-topic weather"}\n```'
  );
  assert.equal(fenced.shouldBranch, true, 'fenced json should be parsed');

  console.log('All branch suggestion parsing cases passed.');
};

run();
