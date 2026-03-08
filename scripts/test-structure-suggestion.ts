import assert from 'node:assert/strict';
import { parseStructureSuggestionDecision } from '../src/utils/structureSuggestion';

const run = () => {
  const parsed = parseStructureSuggestionDecision(
    JSON.stringify({
      primary_action: 'return_parent',
      asset_action: 'extract_task_sop',
      confidence: 0.82,
      reason: 'The branch seems to have produced a usable intermediate result.',
      asset_reason: 'The branch contains a reusable step sequence.',
      show_suggestion: true,
    })
  );

  assert.equal(parsed.primaryAction, 'return_parent');
  assert.equal(parsed.assetAction, 'extract_task_sop');
  assert.equal(parsed.confidence, 0.82);
  assert.equal(parsed.showSuggestion, true);

  const fallback = parseStructureSuggestionDecision('not-json');
  assert.equal(fallback.primaryAction, 'continue');
  assert.equal(fallback.assetAction, 'none');
  assert.equal(fallback.showSuggestion, false);

  console.log('Structure suggestion tests passed.');
};

run();
