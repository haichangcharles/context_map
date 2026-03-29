import assert from 'node:assert/strict';
import {
  buildContextMapScopeSummary,
  countContextMapNodeVisualStates,
  resolveContextMapNodeVisualState,
  type ContextMapNodeVisualState,
} from '../src/utils/contextMapNodeState';

const run = () => {
  assert.equal(
    resolveContextMapNodeVisualState({ isActive: true, isIncluded: false, isExcluded: false }),
    'active',
    'naturally active nodes should render as active when no explicit governance overrides them'
  );

  assert.equal(
    resolveContextMapNodeVisualState({ isActive: true, isIncluded: true, isExcluded: false }),
    'included',
    'explicit include should stay visible even when the node also belongs to the active path'
  );

  assert.equal(
    resolveContextMapNodeVisualState({ isActive: true, isIncluded: true, isExcluded: true }),
    'excluded',
    'explicit exclude should override all other visual states'
  );

  assert.equal(
    resolveContextMapNodeVisualState({ isActive: false, isIncluded: false, isExcluded: false }),
    'visible',
    'structurally visible nodes outside the current context should use the visible-only state'
  );

  const counts = countContextMapNodeVisualStates([
    { id: 'n1', state: 'active' },
    { id: 'n2', state: 'included' },
    { id: 'n3', state: 'included' },
    { id: 'n4', state: 'visible' },
    { id: 'n5', state: 'excluded' },
  ]);

  assert.deepEqual(
    counts,
    {
      active: 1,
      included: 2,
      visible: 1,
      excluded: 1,
    } satisfies Record<ContextMapNodeVisualState, number>,
    'state counting should preserve all four visual buckets'
  );

  const mainlineSummary = buildContextMapScopeSummary({
    basePath: 'mainline',
    activeCount: 4,
    includedCount: 1,
    visibleCount: 3,
    excludedCount: 1,
  });

  assert.equal(mainlineSummary.label, 'Mainline view');
  assert.match(
    mainlineSummary.helperText,
    /branches stay visible/i,
    'mainline helper copy should explain that white branch nodes can still be shown'
  );

  const branchSummary = buildContextMapScopeSummary({
    basePath: 'branch-1',
    branchLabel: 'Research branch',
    activeCount: 5,
    includedCount: 1,
    visibleCount: 4,
    excludedCount: 0,
  });

  assert.equal(branchSummary.label, 'Research branch');
  assert.match(
    branchSummary.helperText,
    /outside the current context/i,
    'branch helper copy should explain that some visible nodes are structural only'
  );

  console.log('Context map node-state helpers passed.');
};

run();
