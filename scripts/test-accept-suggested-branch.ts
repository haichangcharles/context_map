import assert from 'node:assert/strict';
import { useAppStore } from '../src/store';

const resetStore = () => {
  useAppStore.setState(useAppStore.getInitialState(), true);
};

const run = () => {
  resetStore();

  const projectId = useAppStore.getState().createProject('Accept Suggested Branch');
  const state0 = useAppStore.getState();
  const contextId = state0.projects[projectId].active_context_id;

  const n1 = useAppStore.getState().addNode(projectId, null, 'user', 'main-1', null);
  const n2 = useAppStore.getState().addNode(projectId, n1, 'assistant', 'main-2', null);
  const n3 = useAppStore.getState().addNode(projectId, n2, 'user', 'main-3', null);

  // Simulate QA pair that was first appended to mainline.
  const q = useAppStore.getState().addNode(projectId, n3, 'user', 'branch-q', null);
  const a = useAppStore.getState().addNode(projectId, q, 'assistant', 'branch-a', null);

  const branchId = useAppStore.getState().acceptSuggestedBranch(projectId, n3, [q, a]);
  assert.ok(branchId, 'acceptSuggestedBranch should create a new branch');

  const state1 = useAppStore.getState();
  const createdBranchId = branchId as string;
  const mainlineAfterAccept = state1.mainlines[projectId];

  assert.equal(state1.contexts[contextId].base_path, createdBranchId, 'after accept, context should switch to new branch');
  assert.ok(!mainlineAfterAccept.includes(q), 'accepted q should be removed from mainline');
  assert.ok(!mainlineAfterAccept.includes(a), 'accepted a should be removed from mainline');
  assert.equal(state1.nodes[q].branch_id, createdBranchId, 'accepted q should be tagged as branch node');
  assert.equal(state1.nodes[a].branch_id, createdBranchId, 'accepted a should be tagged as branch node');
  assert.equal(state1.nodes[q].parent_id, n3, 'first moved node should keep anchor as parent');
  assert.equal(state1.nodes[a].parent_id, q, 'assistant moved node should stay chained to q');

  useAppStore.getState().returnToMainline(projectId);
  const state2 = useAppStore.getState();
  assert.equal(state2.contexts[contextId].base_path, 'mainline', 'return should switch context back to mainline');

  const latestMainline = state2.mainlines[projectId];
  const parentForNext = latestMainline[latestMainline.length - 1] || null;
  const n4 = useAppStore.getState().addNode(projectId, parentForNext, 'user', 'post-return-mainline', null);

  const state3 = useAppStore.getState();
  assert.equal(state3.nodes[n4].branch_id, null, 'new post-return node should be mainline node');
  assert.equal(state3.nodes[n4].parent_id, n3, 'new post-return node should continue from true mainline tail');
  assert.ok(!state3.mainlines[projectId].includes(q), 'q should remain out of mainline after new message');
  assert.ok(!state3.mainlines[projectId].includes(a), 'a should remain out of mainline after new message');

  // Defensive case: stale UI passes branch node as parent while context is mainline.
  const n5 = useAppStore.getState().addNode(projectId, a, 'assistant', 'should-still-be-mainline', null);
  const state4 = useAppStore.getState();
  const mainlineAfterN5 = state4.mainlines[projectId];
  const expectedParentForN5 = mainlineAfterN5[mainlineAfterN5.length - 2] || null;
  assert.equal(state4.nodes[n5].branch_id, null, 'stale parent defensive node should remain mainline');
  assert.equal(state4.nodes[n5].parent_id, expectedParentForN5, 'stale branch parent should be corrected to mainline tail');

  console.log('Accept suggested branch flow passed.');
};

run();
