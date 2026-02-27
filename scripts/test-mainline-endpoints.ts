import assert from 'node:assert/strict';
import { useAppStore } from '../src/store';

const resetStore = () => {
  useAppStore.setState(useAppStore.getInitialState(), true);
};

const assertOrdered = (arr: string[], first: string, second: string, label: string) => {
  const i = arr.indexOf(first);
  const j = arr.indexOf(second);
  assert.ok(i !== -1, `${label}: missing first endpoint`);
  assert.ok(j !== -1, `${label}: missing second endpoint`);
  assert.ok(i <= j, `${label}: endpoint order invalid`);
};

const run = () => {
  resetStore();

  const store = useAppStore.getState();
  const projectId = store.createProject('Mainline Endpoint Stress');

  const n1 = useAppStore.getState().addNode(projectId, null, 'user', 'n1', null);
  const n2 = useAppStore.getState().addNode(projectId, n1, 'assistant', 'n2', null);
  const n3 = useAppStore.getState().addNode(projectId, n2, 'user', 'n3', null);

  const branchA = useAppStore.getState().createBranch(projectId, n2);
  const a1 = useAppStore.getState().addNode(projectId, n2, 'user', 'a1', branchA);
  const a2 = useAppStore.getState().addNode(projectId, a1, 'assistant', 'a2', branchA);
  useAppStore.getState().returnToMainline(projectId);

  const branchB = useAppStore.getState().createBranch(projectId, n1);
  const b1 = useAppStore.getState().addNode(projectId, n1, 'user', 'b1', branchB);
  const b2 = useAppStore.getState().addNode(projectId, b1, 'assistant', 'b2', branchB);

  // Case 0: Promote branch should convert promoted nodes to mainline nodes (branch_id = null)
  useAppStore.getState().promoteBranch(projectId, branchA);
  let promotedMainline = useAppStore.getState().mainlines[projectId];
  assert.ok(promotedMainline.includes(a1) && promotedMainline.includes(a2), 'case0: promoted nodes should be in mainline');
  assert.equal(useAppStore.getState().nodes[a1].branch_id, null, 'case0: promoted node a1 should not keep branch_id');
  assert.equal(useAppStore.getState().nodes[a2].branch_id, null, 'case0: promoted node a2 should not keep branch_id');
  assert.equal(useAppStore.getState().branches[branchA].status, 'inactive', 'case0: promoted branch should become inactive');

  // Case 1: Mainline -> branch descendant
  useAppStore.getState().setMainlineEndpoints(projectId, n2, a2);
  let mainline = useAppStore.getState().mainlines[projectId];
  assertOrdered(mainline, n2, a2, 'case1');

  // Case 2: Cross-branch endpoints (a2 and b2 are on different branches)
  useAppStore.getState().setMainlineEndpoints(projectId, a2, b2);
  mainline = useAppStore.getState().mainlines[projectId];
  assertOrdered(mainline, a2, b2, 'case2');

  // Case 3: Works regardless of active context (currently branchB active)
  const activeContextId = useAppStore.getState().projects[projectId].active_context_id;
  useAppStore.setState((state) => ({
    contexts: {
      ...state.contexts,
      [activeContextId]: {
        ...state.contexts[activeContextId],
        base_path: branchB,
      },
    },
  }));
  const activeBasePathBefore = useAppStore.getState().contexts[activeContextId].base_path;
  assert.equal(activeBasePathBefore, branchB, 'case3 setup: expected branchB active');
  useAppStore.getState().setMainlineEndpoints(projectId, b2, n3);
  mainline = useAppStore.getState().mainlines[projectId];
  assertOrdered(mainline, b2, n3, 'case3');
  assert.equal(useAppStore.getState().contexts[activeContextId].base_path, 'mainline', 'case3: should return to mainline');

  // Case 4: Reverse direction (descendant -> ancestor) still succeeds
  useAppStore.getState().setMainlineEndpoints(projectId, a2, n1);
  mainline = useAppStore.getState().mainlines[projectId];
  assertOrdered(mainline, a2, n1, 'case4');

  // Case 5: Same node as both endpoints
  useAppStore.getState().setMainlineEndpoints(projectId, n2, n2);
  mainline = useAppStore.getState().mainlines[projectId];
  assert.ok(mainline.includes(n2), 'case5: same endpoint should remain in mainline');

  // Case 6: Nodes removed from mainline should become branch nodes (not orphaned)
  useAppStore.getState().setMainlineEndpoints(projectId, n2, n3);
  const stateAfterCase6 = useAppStore.getState();
  const n1After = stateAfterCase6.nodes[n1];
  assert.ok(!stateAfterCase6.mainlines[projectId].includes(n1), 'case6: n1 should be outside new mainline');
  assert.ok(!!n1After.branch_id, 'case6: removed mainline node should be assigned a branch_id');
  const branchForN1 = n1After.branch_id as string;
  assert.ok(!!stateAfterCase6.branches[branchForN1], 'case6: auto branch should exist');

  // Case 7: Undo/redo structure cache should restore mainline/branch state
  const beforeChangeMainline = [...useAppStore.getState().mainlines[projectId]];
  useAppStore.getState().setMainlineEndpoints(projectId, n1, b2);
  const changedMainline = [...useAppStore.getState().mainlines[projectId]];
  assert.notDeepEqual(changedMainline, beforeChangeMainline, 'case7: setup should change mainline');

  useAppStore.getState().undoStructureChange();
  assert.deepEqual(useAppStore.getState().mainlines[projectId], beforeChangeMainline, 'case7: undo should restore previous mainline');

  useAppStore.getState().redoStructureChange();
  assert.deepEqual(useAppStore.getState().mainlines[projectId], changedMainline, 'case7: redo should restore changed mainline');

  // Case 8: Reset to natural should restore rolling default structure state
  const naturalMainline = [...useAppStore.getState().naturalMainlines[projectId]];
  useAppStore.getState().setMainlineEndpoints(projectId, a2, n1);
  assert.notDeepEqual(useAppStore.getState().mainlines[projectId], naturalMainline, 'case8: setup should diverge from natural mainline');
  useAppStore.getState().resetStructureToNatural(projectId);
  assert.deepEqual(useAppStore.getState().mainlines[projectId], naturalMainline, 'case8: mainline should reset to natural baseline');
  assert.equal(useAppStore.getState().nodes[a1].branch_id, branchA, 'case8: branch node should return to natural branch');
  assert.equal(useAppStore.getState().nodes[a2].branch_id, branchA, 'case8: branch node should return to natural branch');

  console.log('All mainline endpoint stress cases passed.');
};

run();
