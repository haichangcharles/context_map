import assert from 'node:assert/strict';
import {
  buildInlineSuggestions,
  clampInlineSuggestionIndex,
} from '../src/utils/inlineSuggestions';

const run = () => {
  const items = buildInlineSuggestions(
    {
      targetNodeId: 'assistant-1',
      branchSuggestion: {
        reason: 'This should become a side path.',
        assetAction: 'extract_task_sop',
        assetReason: 'This workflow is reusable.',
      },
      structureSuggestion: {
        primaryAction: 'return_parent',
        reason: 'The branch has converged.',
        assetAction: 'extract_reasoning',
        assetReason: 'The reasoning sequence is reusable.',
      },
    },
    'assistant-1'
  );

  assert.equal(items.length, 4);
  assert.deepEqual(
    items.map((item) => item.kind),
    ['branch', 'branch_extract', 'return_parent', 'structure_extract']
  );

  assert.equal(clampInlineSuggestionIndex(0, items.length), 0);
  assert.equal(clampInlineSuggestionIndex(3, items.length), 3);
  assert.equal(clampInlineSuggestionIndex(99, items.length), 3);
  assert.equal(clampInlineSuggestionIndex(-1, items.length), 0);
  assert.equal(clampInlineSuggestionIndex(2, 0), 0);

  const unrelated = buildInlineSuggestions(
    {
      targetNodeId: 'assistant-1',
      branchSuggestion: { reason: 'Only branch', assetAction: 'none', assetReason: '' },
      structureSuggestion: null,
    },
    'assistant-2'
  );
  assert.equal(unrelated.length, 0);

  console.log('Inline suggestion tests passed.');
};

run();
