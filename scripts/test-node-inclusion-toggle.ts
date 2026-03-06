import assert from 'node:assert/strict';
import { useAppStore } from '../src/store';

const resetStore = () => {
  useAppStore.setState(useAppStore.getInitialState(), true);
};

const run = () => {
  resetStore();

  const store = useAppStore.getState();
  const projectId = store.createProject('Node Inclusion Toggle');

  const n1 = useAppStore.getState().addNode(projectId, null, 'user', 'n1', null);
  const n2 = useAppStore.getState().addNode(projectId, n1, 'assistant', 'n2', null);

  const branchId = useAppStore.getState().createBranch(projectId, n1);
  const b1 = useAppStore.getState().addNode(projectId, n1, 'user', 'b1', branchId);
  useAppStore.getState().returnToMainline(projectId);

  const contextId = useAppStore.getState().projects[projectId].active_context_id;

  // Mainline node starts effectively included via natural path.
  useAppStore.getState().cycleNodeInclusionState(projectId, n1);
  let context = useAppStore.getState().contexts[contextId];
  assert.deepEqual(context.included_nodes, [], 'active natural node should not become explicitly included');
  assert.deepEqual(context.excluded_nodes, [n1], 'active natural node should become excluded on first click');

  useAppStore.getState().cycleNodeInclusionState(projectId, n1);
  context = useAppStore.getState().contexts[contextId];
  assert.deepEqual(context.included_nodes, [n1], 'second click should move active node into explicit include');
  assert.deepEqual(context.excluded_nodes, [], 'second click should clear exclude');

  useAppStore.getState().cycleNodeInclusionState(projectId, n1);
  context = useAppStore.getState().contexts[contextId];
  assert.deepEqual(context.included_nodes, [], 'third click should clear explicit include');
  assert.deepEqual(context.excluded_nodes, [n1], 'third click should return to excluded state');

  // Branch node starts effectively excluded while mainline context is active.
  useAppStore.getState().cycleNodeInclusionState(projectId, b1);
  context = useAppStore.getState().contexts[contextId];
  assert.deepEqual(context.included_nodes, [b1], 'inactive natural node should become included on first click');
  assert.deepEqual(context.excluded_nodes, [n1], 'inactive natural node first click should preserve other explicit excludes');

  useAppStore.getState().cycleNodeInclusionState(projectId, b1);
  context = useAppStore.getState().contexts[contextId];
  assert.deepEqual(context.included_nodes, [], 'second click should clear explicit include for inactive node');
  assert.deepEqual(context.excluded_nodes.sort(), [b1, n1].sort(), 'second click should exclude inactive node');

  console.log('Node inclusion toggle behaves as explicit two-state toggle.');
};

run();
