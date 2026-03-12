import assert from 'node:assert/strict';
import { getNodeIdsIntersectingSelectionRect, reconcileSelectedNodeIds, resolveNodeSelectionClick } from '../src/utils/selectionState';
import { CONTEXT_MAP_SELECTION_BODY_CLASS, syncBodyClassToggle } from '../src/utils/contextMapInteraction';
import { useAppStore } from '../src/store';

const run = () => {
  const selectedAfterFirstClick = reconcileSelectedNodeIds([], [
    { type: 'select', id: 'node-1', selected: true },
  ]);

  assert.deepEqual(
    selectedAfterFirstClick,
    ['node-1'],
    'first selection should add the node to the custom selection set'
  );

  const selectedAfterSecondClick = reconcileSelectedNodeIds(selectedAfterFirstClick, [
    { type: 'select', id: 'node-1', selected: false },
  ]);

  assert.deepEqual(
    selectedAfterSecondClick,
    [],
    'second click in selection/delete mode should unselect instead of keeping stale selection state'
  );

  const selectedAfterMixedChanges = reconcileSelectedNodeIds(['node-1', 'node-2'], [
    { type: 'select', id: 'node-1', selected: false },
    { type: 'select', id: 'node-3', selected: true },
  ]);

  assert.deepEqual(
    selectedAfterMixedChanges.sort(),
    ['node-2', 'node-3'],
    'selection reconciliation should support deselecting and selecting in the same batch'
  );

  assert.deepEqual(
    resolveNodeSelectionClick(['node-1', 'node-2'], 'node-3', false).sort(),
    ['node-1', 'node-2', 'node-3'],
    'plain click should preserve the existing multi-selection and add the clicked node'
  );

  assert.deepEqual(
    resolveNodeSelectionClick(['node-1'], 'node-2', true).sort(),
    ['node-1', 'node-2'],
    'shift-click should add another node without clearing the existing selection'
  );

  assert.deepEqual(
    resolveNodeSelectionClick(['node-1', 'node-2'], 'node-2', true),
    ['node-1'],
    'shift-click on an already-selected node should remove only that node'
  );

  assert.deepEqual(
    getNodeIdsIntersectingSelectionRect(
      [
        { id: 'node-1', x: 0, y: 0, width: 120, height: 80 },
        { id: 'node-2', x: 200, y: 20, width: 120, height: 80 },
        { id: 'node-3', x: 360, y: 160, width: 120, height: 80 },
      ],
      { left: 40, right: 260, top: 10, bottom: 130 }
    ).sort(),
    ['node-1', 'node-2'],
    'shift-drag marquee should include every node whose bounds intersect the selection rect'
  );

  assert.deepEqual(
    reconcileSelectedNodeIds(['node-1', 'node-3'], [
      { type: 'select', id: 'node-1', selected: false },
      { type: 'select', id: 'node-2', selected: true },
    ]).sort(),
    ['node-2', 'node-3'],
    'marquee toggling should deselect already-selected nodes while adding newly intersected ones'
  );

  const classSet = new Set<string>();
  const mockBody = {
    classList: {
      add: (className: string) => classSet.add(className),
      remove: (className: string) => classSet.delete(className),
    },
  };

  syncBodyClassToggle(mockBody, CONTEXT_MAP_SELECTION_BODY_CLASS, true);
  assert.ok(
    classSet.has(CONTEXT_MAP_SELECTION_BODY_CLASS),
    'selection/delete mode should suppress global text selection like resize mode does'
  );

  syncBodyClassToggle(mockBody, CONTEXT_MAP_SELECTION_BODY_CLASS, false);
  assert.ok(
    !classSet.has(CONTEXT_MAP_SELECTION_BODY_CLASS),
    'leaving selection/delete mode should restore normal text selection'
  );

  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().startNodeSelectionMode('delete');
  useAppStore.getState().toggleNodeSelection('node-1');
  assert.deepEqual(
    useAppStore.getState().selectedNodeIds,
    ['node-1'],
    'shared selection state should mark a node on first click'
  );

  useAppStore.getState().toggleNodeSelection('node-2', false);
  assert.deepEqual(
    useAppStore.getState().selectedNodeIds.sort(),
    ['node-1', 'node-2'],
    'plain click should keep the original additive multi-select behavior'
  );

  useAppStore.getState().toggleNodeSelection('node-3', true);
  assert.deepEqual(
    useAppStore.getState().selectedNodeIds.sort(),
    ['node-1', 'node-2', 'node-3'],
    'shift-click should preserve the old selection and add the clicked node'
  );

  useAppStore.getState().toggleNodeSelection('node-3', true);
  assert.deepEqual(
    useAppStore.getState().selectedNodeIds.sort(),
    ['node-1', 'node-2'],
    'shift-clicking an already-selected node should only unmark that node'
  );

  console.log('Selection mode toggle reconciliation passed.');
};

run();
