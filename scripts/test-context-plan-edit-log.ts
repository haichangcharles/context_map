import assert from 'node:assert/strict';

class MemoryStorage {
  private rows = new Map<string, string>();
  getItem(key: string) { return this.rows.get(key) ?? null; }
  setItem(key: string, value: string) { this.rows.set(key, value); }
  removeItem(key: string) { this.rows.delete(key); }
}

const storage = new MemoryStorage();
storage.setItem('context-map.active-user-id', 'pilot-user');
(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = { localStorage: storage };

const { useAppStore } = await import('../src/store');
const { logContextPlanProposal, recordContextTurnPlan, readContextTurnPlans } = await import('../src/utils/contextPlanEditLog');

const projectId = useAppStore.getState().createProject('Context plan edit pilot');
const nodeId = useAppStore.getState().addNode(projectId, null, 'user', 'PRIVATE_MESSAGE_DO_NOT_LOG', null);
const contextId = useAppStore.getState().projects[projectId].active_context_id;
const before = useAppStore.getState().contexts[contextId];

useAppStore.getState().cycleNodeInclusionState(projectId, nodeId);

const raw = storage.getItem('context-map.context-plan-edits.v1');
assert.ok(raw, 'a manual node scope edit should create a local event');
assert.ok(!raw.includes('PRIVATE_MESSAGE_DO_NOT_LOG'), 'event must not duplicate conversation text');
const events = JSON.parse(raw) as Record<string, Array<Record<string, unknown>>>;
assert.equal(events['pilot-user']?.length, 1);
const event = events['pilot-user'][0];
assert.equal(event.project_id, projectId);
assert.equal(event.context_id, contextId);
assert.deepEqual(event.touched_node_ids, [nodeId]);
assert.deepEqual(event.before, {
  base_path: before.base_path,
  included_nodes: before.included_nodes,
  excluded_nodes: before.excluded_nodes,
});
assert.deepEqual(event.after, {
  base_path: useAppStore.getState().contexts[contextId].base_path,
  included_nodes: useAppStore.getState().contexts[contextId].included_nodes,
  excluded_nodes: useAppStore.getState().contexts[contextId].excluded_nodes,
});

useAppStore.getState().cycleNodeInclusionState(projectId, 'missing-node');
const afterNoop = JSON.parse(storage.getItem('context-map.context-plan-edits.v1')!) as Record<string, unknown[]>;
assert.equal(afterNoop['pilot-user'].length, 1, 'invalid actions must not become false feedback');

const secondNodeId = useAppStore.getState().addNode(projectId, nodeId, 'assistant', 'SECOND_PRIVATE_MESSAGE', null);
useAppStore.getState().batchToggleInclusion(projectId, [nodeId, secondNodeId], 'exclude');
const afterBatch = JSON.parse(storage.getItem('context-map.context-plan-edits.v1')!) as Record<string, Array<Record<string, unknown>>>;
assert.equal(afterBatch['pilot-user'].length, 2, 'batch editing should be one user decision');
assert.equal(afterBatch['pilot-user'][1].action, 'batch_scope_edit');
assert.deepEqual(afterBatch['pilot-user'][1].touched_node_ids, [nodeId, secondNodeId]);
assert.ok(!JSON.stringify(afterBatch).includes('SECOND_PRIVATE_MESSAGE'));

const branchId = useAppStore.getState().createBranch(projectId, secondNodeId);
const afterBranchOpen = JSON.parse(storage.getItem('context-map.context-plan-edits.v1')!) as Record<string, Array<Record<string, unknown>>>;
assert.equal(afterBranchOpen['pilot-user'].length, 3, 'opening a branch should capture the route decision');
assert.equal(afterBranchOpen['pilot-user'][2].action, 'branch_open_manual');
assert.deepEqual(afterBranchOpen['pilot-user'][2].touched_node_ids, [secondNodeId]);
assert.equal((afterBranchOpen['pilot-user'][2].after as { base_path: string }).base_path, branchId);

useAppStore.getState().returnToMainline(projectId);
const afterReturn = JSON.parse(storage.getItem('context-map.context-plan-edits.v1')!) as Record<string, Array<Record<string, unknown>>>;
assert.equal(afterReturn['pilot-user'].length, 4, 'return should capture a route decision');
assert.equal(afterReturn['pilot-user'][3].action, 'route_return_mainline');
assert.equal((afterReturn['pilot-user'][3].before as { base_path: string }).base_path, branchId);
assert.equal((afterReturn['pilot-user'][3].after as { base_path: string }).base_path, 'mainline');

useAppStore.getState().returnToMainline(projectId);
const afterReturnNoop = JSON.parse(storage.getItem('context-map.context-plan-edits.v1')!) as Record<string, unknown[]>;
assert.equal(afterReturnNoop['pilot-user'].length, 4, 'no-op route action must not create a false preference');

const acceptedProjectId = useAppStore.getState().createProject('Accepted branch pilot');
const anchorId = useAppStore.getState().addNode(acceptedProjectId, null, 'assistant', 'PRIVATE_ANCHOR', null);
const movedUserId = useAppStore.getState().addNode(acceptedProjectId, anchorId, 'user', 'PRIVATE_MOVED_USER', null);
const movedAssistantId = useAppStore.getState().addNode(acceptedProjectId, movedUserId, 'assistant', 'PRIVATE_MOVED_ASSISTANT', null);
const acceptedBranchId = useAppStore.getState().acceptSuggestedBranch(acceptedProjectId, anchorId, [movedUserId, movedAssistantId]);
assert.ok(acceptedBranchId, 'fixture should be a valid suggested branch');
const afterAccept = JSON.parse(storage.getItem('context-map.context-plan-edits.v1')!) as Record<string, Array<Record<string, unknown>>>;
assert.equal(afterAccept['pilot-user'].length, 5, 'accepted branch should create one plan decision');
assert.equal(afterAccept['pilot-user'][4].action, 'branch_open_accept');
assert.deepEqual(afterAccept['pilot-user'][4].touched_node_ids, [anchorId, movedUserId, movedAssistantId]);
assert.ok(!JSON.stringify(afterAccept).includes('PRIVATE_MOVED_USER'));

useAppStore.getState().returnToParentBranch(acceptedProjectId);
const afterParent = JSON.parse(storage.getItem('context-map.context-plan-edits.v1')!) as Record<string, Array<Record<string, unknown>>>;
assert.equal(afterParent['pilot-user'].length, 6);
assert.equal(afterParent['pilot-user'][5].action, 'route_return_parent');
assert.equal((afterParent['pilot-user'][5].after as { base_path: string }).base_path, 'mainline');

useAppStore.getState().returnToParentBranch(acceptedProjectId);
const afterParentNoop = JSON.parse(storage.getItem('context-map.context-plan-edits.v1')!) as Record<string, unknown[]>;
assert.equal(afterParentNoop['pilot-user'].length, 6);

const proposalContextId = useAppStore.getState().projects[acceptedProjectId].active_context_id;
const proposalContext = useAppStore.getState().contexts[proposalContextId];
const proposal = {
  suggestionId: 'proposal-1', projectId: acceptedProjectId, context: proposalContext,
  originBasePath: 'mainline', anchorNodeId: anchorId, movedNodeIds: [movedUserId, movedAssistantId],
} as const;
logContextPlanProposal({ ...proposal, phase: 'created' });
logContextPlanProposal({ ...proposal, phase: 'created' });
logContextPlanProposal({ ...proposal, phase: 'shown' });
logContextPlanProposal({ ...proposal, phase: 'shown' });
logContextPlanProposal({ ...proposal, phase: 'rejected' });
const proposalsRaw = storage.getItem('context-map.context-plan-proposals.v1');
assert.ok(proposalsRaw);
assert.ok(!proposalsRaw.includes('PRIVATE_MOVED_USER'));
const proposals = JSON.parse(proposalsRaw) as Record<string, Array<Record<string, unknown>>>;
assert.deepEqual(proposals['pilot-user'].map((x) => x.phase), ['created', 'shown', 'rejected']);
assert.deepEqual(proposals['pilot-user'][0].candidate, {
  route: 'open', origin_base_path: 'mainline', anchor_node_id: anchorId,
  moved_node_ids: [movedUserId, movedAssistantId],
});

recordContextTurnPlan({ projectId, turnNodeId: nodeId, query: 'Continue the plan', context: before, selectedNodeIds: [nodeId, nodeId, secondNodeId] });
recordContextTurnPlan({ projectId, turnNodeId: nodeId, query: 'Duplicate call', context: before, selectedNodeIds: [] });
const turns = readContextTurnPlans(storage, 'pilot-user');
assert.equal(turns.length, 1, 'one sent turn should have one immutable context snapshot');
assert.deepEqual(turns[0].selected_node_ids, [nodeId, secondNodeId]);
assert.equal(turns[0].context_plan.base_path, before.base_path);

console.log('Context plan edit logging passed.');
