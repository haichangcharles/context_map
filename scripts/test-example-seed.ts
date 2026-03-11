import assert from 'node:assert/strict';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.has(key) ? this.values.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

const run = async () => {
  const localStorage = new MemoryStorage();
  localStorage.setItem('context-map.active-user-id', 'test');

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
  });

  const { useAppStore } = await import('../src/store');
  const state = useAppStore.getState();

  const project = state.projects['example-project'];
  assert.ok(project, 'example project should be seeded for the test user');
  assert.equal(project.title, 'Tutorial - Learn Context Map');
  assert.equal(state.activeProjectId, 'example-project');

  const mainline = state.mainlines['example-project'] || [];
  assert.deepEqual(mainline, ['ex-n1', 'ex-n2', 'ex-n3', 'ex-n4', 'ex-n5', 'ex-n6']);
  assert.match(state.nodes['ex-n1']?.content || '', /tutorial/i);
  assert.match(state.nodes['ex-n2']?.content || '', /now|start here|first/i);
  assert.match(state.nodes['ex-n2']?.content || '', /come back|read the next/i);
  assert.match(state.nodes['ex-n4']?.content || '', /hover/i);
  assert.match(state.nodes['ex-n4']?.content || '', /Branch/i);
  assert.match(state.nodes['ex-n4']?.content || '', /Locate/i);
  assert.doesNotMatch(state.nodes['ex-n4']?.content || '', /double-click|double click/i);
  assert.match(state.nodes['ex-r2']?.content || '', /top.*return to mainline/i);
  assert.match(state.nodes['ex-r2']?.content || '', /click it|use it/i);
  assert.match(state.nodes['ex-r2']?.content || '', /come back to this branch on the right|keep reading downward/i);
  assert.match(state.nodes['ex-a2']?.content || '', /Return to Parent|return to parent/i);
  assert.match(state.nodes['ex-a2']?.content || '', /one level up|come back/i);
  assert.match(state.nodes['ex-a2']?.content || '', /head back to the mainline|next step/i);
  assert.match(state.nodes['ex-u2']?.content || '', /Extract Reasoning|extract_reasoning/i);
  assert.match(state.nodes['ex-u2']?.content || '', /Extract SOP|extract_task_sop/i);
  assert.match(state.nodes['ex-u2']?.content || '', /click|Reject/i);
  assert.match(state.nodes['ex-u2']?.content || '', /compare|look back/i);
  assert.match(state.nodes['ex-u2']?.content || '', /Turn this into a reusable SOP/i);
  assert.match(state.nodes['ex-u2']?.content || '', /return to the mainline|follow-up question/i);

  const researchBranch = state.branches['ex-branch-research'];
  const nestedReturnBranch = state.branches['ex-branch-nested-return'];
  const extractBranch = state.branches['ex-branch-extract'];

  assert.equal(researchBranch?.anchor_node_id, 'ex-n4');
  assert.equal(researchBranch?.parent_branch_id, null);
  assert.equal(nestedReturnBranch?.anchor_node_id, 'ex-r2');
  assert.equal(nestedReturnBranch?.parent_branch_id, 'ex-branch-research');
  assert.equal(extractBranch?.anchor_node_id, 'ex-n6');
  assert.equal(extractBranch?.parent_branch_id, null);

  assert.match(state.nodes['ex-n6']?.content || '', /left branch/i);
  assert.match(state.nodes['ex-n6']?.content || '', /one short message of your own/i);

  console.log('Example seed tests passed.');
};

await run();
