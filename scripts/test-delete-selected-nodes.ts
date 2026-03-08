import assert from 'node:assert/strict';
import { previewDeleteSelectedNodes, useAppStore } from '../src/store';

const resetStore = () => {
  useAppStore.setState(useAppStore.getInitialState(), true);
};

const run = () => {
  resetStore();

  const projectId = useAppStore.getState().createProject('Delete Selection');

  const n1 = useAppStore.getState().addNode(projectId, null, 'user', 'n1', null);
  const n2 = useAppStore.getState().addNode(projectId, n1, 'assistant', 'n2', null);
  const n3 = useAppStore.getState().addNode(projectId, n2, 'user', 'n3', null);
  const n4 = useAppStore.getState().addNode(projectId, n3, 'assistant', 'n4', null);

  let preview = previewDeleteSelectedNodes(useAppStore.getState(), projectId, [n4]);
  assert.ok(preview, 'tail delete preview should exist');
  assert.equal(preview?.deletedNodeIds.length, 1, 'tail delete should remove one node');
  assert.equal(preview?.placeholderNodeIds.length, 0, 'tail delete should not require a placeholder');
  assert.ok(!preview?.candidate.nodes[n4], 'tail delete preview should render the candidate map without the deleted node');

  useAppStore.getState().deleteSelectedNodes(projectId, [n4]);
  let state = useAppStore.getState();
  assert.ok(!state.nodes[n4], 'tail delete should remove tail node');
  assert.deepEqual(state.mainlines[projectId], [n1, n2, n3], 'tail delete should trim mainline tail');
  assert.deepEqual(state.naturalMainlines[projectId], [n1, n2, n3], 'tail delete should also update the natural baseline');
  useAppStore.getState().resetStructureToNatural(projectId);
  state = useAppStore.getState();
  assert.ok(!state.nodes[n4], 'reset-to-natural should not resurrect a committed delete');

  preview = previewDeleteSelectedNodes(useAppStore.getState(), projectId, [n2]);
  assert.ok(preview, 'middle delete preview should exist');
  assert.equal(preview?.placeholderNodeIds.length, 0, 'middle delete should splice without placeholder');
  assert.equal(preview?.candidate.nodes[n3].parent_id, n1, 'middle delete preview should already show the spliced candidate chain');

  useAppStore.getState().deleteSelectedNodes(projectId, [n2]);
  state = useAppStore.getState();
  assert.ok(!state.nodes[n2], 'middle delete should remove selected middle node');
  assert.ok(!!state.nodes[n3], 'middle delete should keep the surviving tail');
  assert.equal(state.nodes[n1].parent_id, null, 'first node should remain root');
  assert.equal(state.mainlines[projectId][0], n1, 'mainline should still start at first node');
  assert.equal(state.nodes[n3].parent_id, n1, 'remaining tail should splice back to previous node');

  useAppStore.getState().undoStructureChange();
  state = useAppStore.getState();
  assert.ok(state.nodes[n2] && state.nodes[n3], 'undo should restore deleted middle nodes');

  resetStore();

  const projectId2 = useAppStore.getState().createProject('Delete Anchor Placeholder');
  const m1 = useAppStore.getState().addNode(projectId2, null, 'user', 'm1', null);
  const m2 = useAppStore.getState().addNode(projectId2, m1, 'assistant', 'm2', null);
  const m3 = useAppStore.getState().addNode(projectId2, m2, 'user', 'm3', null);

  const branchId = useAppStore.getState().createBranch(projectId2, m2);
  const b1 = useAppStore.getState().addNode(projectId2, m2, 'user', 'b1', branchId);
  const b2 = useAppStore.getState().addNode(projectId2, b1, 'assistant', 'b2', branchId);
  useAppStore.getState().returnToMainline(projectId2);

  preview = previewDeleteSelectedNodes(useAppStore.getState(), projectId2, [m2]);
  assert.ok(preview, 'anchor delete preview should exist');
  assert.equal(preview?.placeholderNodeIds.length, 1, 'anchor delete should insert one placeholder');
  const previewPlaceholderId = preview?.placeholderNodeIds[0];
  assert.ok(previewPlaceholderId, 'anchor delete preview should expose the placeholder id');
  assert.equal(preview?.nodeVariants[previewPlaceholderId!], 'placeholder', 'preview should explicitly highlight the placeholder');
  assert.equal(preview?.candidate.mainlines[projectId2][1], previewPlaceholderId, 'candidate map should already place the placeholder on the mainline');
  assert.equal(preview?.candidate.nodes[m3].parent_id, previewPlaceholderId, 'candidate map should already reconnect mainline descendants to placeholder');

  useAppStore.getState().deleteSelectedNodes(projectId2, [m2]);
  state = useAppStore.getState();

  const placeholderId = Object.values(state.nodes).find((node) => (
    node.project_id === projectId2 && node.metadata.is_delete_placeholder
  ))?.node_id;

  assert.ok(placeholderId, 'anchor delete should create placeholder node');
  assert.equal(state.mainlines[projectId2][1], placeholderId, 'placeholder should replace anchor on mainline');
  assert.equal(state.nodes[m3].parent_id, placeholderId, 'mainline continuation should attach to placeholder');
  assert.equal(state.nodes[b1].parent_id, placeholderId, 'branch continuation should attach to placeholder');
  assert.equal(state.branches[branchId].anchor_node_id, placeholderId, 'branch anchor should move to placeholder');
  assert.equal(state.nodes[b2].parent_id, b1, 'branch descendant should stay chained');
  useAppStore.getState().resetStructureToNatural(projectId2);
  state = useAppStore.getState();
  assert.ok(!state.nodes[m2], 'reset-to-natural should not resurrect deleted anchor nodes');

  console.log('Delete selection semantics passed.');
};

run();
