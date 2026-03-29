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

  // Mainline node starts naturally active.
  useAppStore.getState().cycleNodeInclusionState(projectId, n1);
  let context = useAppStore.getState().contexts[contextId];
  assert.deepEqual(context.included_nodes, [], 'active natural node should not become explicitly included');
  assert.deepEqual(context.excluded_nodes, [n1], 'active natural node should become excluded on first click');

  useAppStore.getState().cycleNodeInclusionState(projectId, n1);
  context = useAppStore.getState().contexts[contextId];
  assert.deepEqual(context.included_nodes, [], 'second click should restore active natural node back to natural');
  assert.deepEqual(context.excluded_nodes, [], 'second click should clear the explicit exclude');

  // Branch node starts naturally outside the mainline context.
  useAppStore.getState().cycleNodeInclusionState(projectId, b1);
  context = useAppStore.getState().contexts[contextId];
  assert.deepEqual(context.included_nodes, [b1], 'inactive natural node should become included on first click');
  assert.deepEqual(context.excluded_nodes, [], 'inactive natural node first click should not create unrelated excludes');

  useAppStore.getState().cycleNodeInclusionState(projectId, b1);
  context = useAppStore.getState().contexts[contextId];
  assert.deepEqual(context.included_nodes, [], 'second click should clear explicit include for inactive node');
  assert.deepEqual(context.excluded_nodes, [], 'second click should restore inactive node back to natural');

  // Batch include should ensure nodes are in context without creating redundant overrides.
  useAppStore.getState().batchToggleInclusion(projectId, [n1, b1], 'include');
  context = useAppStore.getState().contexts[contextId];
  assert.deepEqual(context.included_nodes, [b1], 'include should only create explicit include for nodes naturally outside context');
  assert.deepEqual(context.excluded_nodes, [], 'include should clear explicit excludes without creating redundant ones');

  // Batch exclude should ensure nodes are out of context without creating redundant overrides.
  useAppStore.getState().batchToggleInclusion(projectId, [n1, b1], 'exclude');
  context = useAppStore.getState().contexts[contextId];
  assert.deepEqual(context.included_nodes, [], 'exclude should clear explicit includes');
  assert.deepEqual(context.excluded_nodes, [n1], 'exclude should only create explicit excludes for nodes naturally in context');

  // Natural should clear all explicit overrides.
  useAppStore.getState().batchToggleInclusion(projectId, [n1, b1], 'natural');
  context = useAppStore.getState().contexts[contextId];
  assert.deepEqual(context.included_nodes, [], 'natural should clear explicit includes');
  assert.deepEqual(context.excluded_nodes, [], 'natural should clear explicit excludes');

  // Invert should flip effective membership and return to natural when run twice.
  useAppStore.getState().batchToggleInclusion(projectId, [n1, b1], 'invert');
  context = useAppStore.getState().contexts[contextId];
  assert.deepEqual(context.included_nodes, [b1], 'invert should pull naturally hidden nodes into context');
  assert.deepEqual(context.excluded_nodes, [n1], 'invert should push naturally active nodes out of context');

  useAppStore.getState().batchToggleInclusion(projectId, [n1, b1], 'invert');
  context = useAppStore.getState().contexts[contextId];
  assert.deepEqual(context.included_nodes, [], 'second invert should clear explicit include back to natural');
  assert.deepEqual(context.excluded_nodes, [], 'second invert should clear explicit exclude back to natural');

  console.log('Node inclusion toggle supports natural reset and deterministic invert semantics.');
};

run();
