import assert from 'node:assert/strict';
import { reconcileSelectedNodeIds } from '../src/utils/selectionState';
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

  useAppStore.getState().toggleNodeSelection('node-1');
  assert.deepEqual(
    useAppStore.getState().selectedNodeIds,
    [],
    'shared selection state should unmark the node on second click instead of falling back to normal context toggling'
  );

  console.log('Selection mode toggle reconciliation passed.');
};

run();
