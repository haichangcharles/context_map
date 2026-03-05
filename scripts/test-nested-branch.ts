import assert from 'node:assert/strict';
import { useAppStore } from '../src/store';

const resetStore = () => {
  useAppStore.setState(useAppStore.getInitialState(), true);
};

const run = () => {
  resetStore();

  const projectId = useAppStore.getState().createProject('Nested Branch');
  const contextId = useAppStore.getState().projects[projectId].active_context_id;

  const n1 = useAppStore.getState().addNode(projectId, null, 'user', 'root', null);
  const n2 = useAppStore.getState().addNode(projectId, n1, 'assistant', 'root-a', null);

  const branchA = useAppStore.getState().createBranch(projectId, n2);
  const a1 = useAppStore.getState().addNode(projectId, n2, 'user', 'a1', branchA);
  const a2 = useAppStore.getState().addNode(projectId, a1, 'assistant', 'a2', branchA);

  const branchB = useAppStore.getState().createBranch(projectId, a2);
  const b1 = useAppStore.getState().addNode(projectId, a2, 'user', 'b1', branchB);
  const b2 = useAppStore.getState().addNode(projectId, b1, 'assistant', 'b2', branchB);

  const state1 = useAppStore.getState();
  assert.equal(state1.branches[branchA].parent_branch_id, null, 'branchA should be root branch');
  assert.equal(state1.branches[branchB].parent_branch_id, branchA, 'branchB should point to parent branchA');
  assert.ok(!!state1.branches[branchA].intent_summary, 'branchA should store intent summary');
  assert.ok(!!state1.branches[branchA].parent_context_tldr, 'branchA should store parent tldr');
  assert.ok(!!state1.branches[branchB].intent_summary, 'branchB should store intent summary');
  assert.ok(!!state1.branches[branchB].parent_context_tldr, 'branchB should store parent tldr');
  assert.equal(state1.contexts[contextId].base_path, branchB, 'createBranch in branch should switch to sub-branch');

  useAppStore.getState().returnToParentBranch(projectId);
  const state2 = useAppStore.getState();
  assert.equal(state2.contexts[contextId].base_path, branchA, 'returnToParentBranch should return to parent branch');

  useAppStore.getState().returnToParentBranch(projectId);
  const state3 = useAppStore.getState();
  assert.equal(state3.contexts[contextId].base_path, 'mainline', 'returnToParentBranch at root branch should return to mainline');

  const tail = state3.mainlines[projectId][state3.mainlines[projectId].length - 1] || null;
  const n3 = useAppStore.getState().addNode(projectId, tail, 'user', 'mainline-after-nested', null);
  const state4 = useAppStore.getState();
  assert.equal(state4.nodes[n3].branch_id, null, 'node after nested returns should be mainline');
  assert.ok(!state4.mainlines[projectId].includes(a1), 'branchA nodes should not leak into mainline');
  assert.ok(!state4.mainlines[projectId].includes(b1), 'branchB nodes should not leak into mainline');
  assert.equal(state4.nodes[b2].branch_id, branchB, 'nested branch nodes keep nested branch id');

  console.log('Nested branch flow passed.');
};

run();
