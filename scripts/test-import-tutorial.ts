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
}

const run = async () => {
  const localStorage = new MemoryStorage();
  localStorage.setItem('context-map.active-user-id', 'import-check');
  localStorage.setItem('context-map.app-state.v1:import-check', JSON.stringify({
    state: {
      projects: {},
      nodes: {},
      branches: {},
      mainlines: {},
      contexts: {},
      patterns: {},
      pastStructureSnapshots: [],
      futureStructureSnapshots: [],
      naturalMainlines: {},
      naturalBranches: {},
      deletedNodeIds: [],
      isNodeSelectionMode: false,
      nodeSelectionIntent: 'batch',
      selectedNodeIds: [],
      activeProjectId: null,
    },
    version: 0,
  }));

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
  });

  const { useAppStore } = await import('../src/store');
  useAppStore.setState(useAppStore.getInitialState(), true);

  const before = useAppStore.getState();
  assert.equal(Object.keys(before.projects).length, 0, 'test should start without seeded tutorial');

  const importedZhProjectId = useAppStore.getState().importTutorialProject('zh');
  const importedEnProjectId = useAppStore.getState().importTutorialProject('en');
  const after = useAppStore.getState();
  const zhProject = after.projects[importedZhProjectId];
  const enProject = after.projects[importedEnProjectId];

  assert.ok(zhProject, 'zh import should create a tutorial project');
  assert.ok(enProject, 'en import should create a tutorial project');
  assert.equal(after.activeProjectId, importedEnProjectId, 'last imported tutorial should become active');
  assert.match(zhProject.title, /教程/);
  assert.match(enProject.title, /Tutorial/i);

  const zhMainline = after.mainlines[importedZhProjectId] || [];
  const enMainline = after.mainlines[importedEnProjectId] || [];
  assert.equal(zhMainline.length, 6, 'zh tutorial import should include the expected mainline length');
  assert.equal(enMainline.length, 6, 'en tutorial import should include the expected mainline length');

  const zhNodeContents = zhMainline.map((nodeId) => after.nodes[nodeId]?.content || '');
  const enNodeContents = enMainline.map((nodeId) => after.nodes[nodeId]?.content || '');
  assert.match(zhNodeContents[1] || '', /主线/);
  assert.match(zhNodeContents[3] || '', /悬停/);
  assert.match(zhNodeContents[3] || '', /Locate/);
  assert.match(zhNodeContents[5] || '', /左侧那条 branch/);
  assert.match(enNodeContents[1] || '', /mainline/i);
  assert.match(enNodeContents[3] || '', /hover/i);
  assert.match(enNodeContents[3] || '', /Locate/);
  assert.match(enNodeContents[5] || '', /branch on the left/i);
  assert.doesNotMatch(enNodeContents[3] || '', /double-click|double click/i);

  const zhProjectNodes = Object.values(after.nodes).filter((node) => node.project_id === importedZhProjectId);
  const zhCombinedText = zhProjectNodes.map((node) => node.content).join('\n');
  assert.match(zhCombinedText, /返回主线/);
  assert.match(zhCombinedText, /返回上一级/);
  assert.match(zhCombinedText, /提炼 SOP/);
  assert.match(zhCombinedText, /把这段整理成可复用 SOP/);

  const enProjectNodes = Object.values(after.nodes).filter((node) => node.project_id === importedEnProjectId);
  const enCombinedText = enProjectNodes.map((node) => node.content).join('\n');
  assert.match(enCombinedText, /Return to Mainline/i);
  assert.match(enCombinedText, /Return to Parent/i);
  assert.match(enCombinedText, /Extract Reasoning|extract_reasoning/i);
  assert.match(enCombinedText, /hover/i);
  assert.match(enCombinedText, /Turn this into a reusable SOP/i);

  console.log('Import tutorial tests passed.');
};

await run();
