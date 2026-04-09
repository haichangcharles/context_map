import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

assert.match(appSource, /Import Case/, 'App should expose an Import Case entry in the top bar');
assert.match(appSource, /阶段 1|Stage 1/, 'App should offer staged career case imports');
assert.match(appSource, /阶段 2|Stage 2/, 'App should offer multiple staged imports');
assert.match(appSource, /阶段 3|Stage 3/, 'App should include a later-stage import');
assert.match(appSource, /阶段 4|Stage 4/, 'App should include a final-stage import');

const run = async () => {
  const localStorage = new MemoryStorage();
  localStorage.setItem('context-map.active-user-id', 'career-case-check');
  localStorage.setItem('context-map.app-state.v1:career-case-check', JSON.stringify({
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

  const state = useAppStore.getState();
  assert.equal(typeof state.importCareerCaseProject, 'function', 'Store should expose a career case import action');

  const importedZhStage1ProjectId = state.importCareerCaseProject('stage1', 'zh');
  const stage1State = useAppStore.getState();
  const zhStage1Project = stage1State.projects[importedZhStage1ProjectId];
  assert.ok(zhStage1Project, 'zh stage 1 import should create a career case project');
  assert.match(zhStage1Project.title, /阶段 1|职业/);

  const stage1Nodes = Object.values(stage1State.nodes).filter((node) => node.project_id === importedZhStage1ProjectId);
  const stage1EditedNode = stage1Nodes.find((node) => !!node.metadata.edited_at);
  assert.ok(stage1EditedNode, 'stage 1 should include an edited node');
  assert.doesNotMatch(stage1EditedNode?.content || '', /C\+\+/i, 'edited stage 1 node should not retain the fabricated C++ claim');

  const importedEnStage2ProjectId = useAppStore.getState().importCareerCaseProject('stage2', 'en');
  const stage2FocusedState = useAppStore.getState();
  const enStage2Project = stage2FocusedState.projects[importedEnStage2ProjectId];
  assert.ok(enStage2Project, 'en stage 2 import should create a career case project');
  assert.match(enStage2Project.title, /Stage 2|Career Transition Case/i);
  const stage2ContextFocused = stage2FocusedState.contexts[enStage2Project.active_context_id];
  assert.equal(stage2ContextFocused.base_path.includes('branch-pm'), true, 'stage 2 should focus on the PM branch');
  assert.equal(stage2FocusedState.activeProjectId, importedEnStage2ProjectId, 'stage 2 import should become active immediately');
  assert.equal(stage2FocusedState.isNodeSelectionMode, true, 'stage 2 should enter selection mode');
  assert.equal(stage2FocusedState.nodeSelectionIntent, 'batch', 'stage 2 should be a batch-selection snapshot');
  assert.ok(stage2FocusedState.selectedNodeIds.length >= 3, 'stage 2 should preselect analyst baggage nodes for Exclude');
  assert.equal(stage2ContextFocused.excluded_nodes.length, 0, 'stage 2 should show the moment before Exclude is applied');

  const importedEnStage3ProjectId = useAppStore.getState().importCareerCaseProject('stage3', 'en');
  const stage3FocusedState = useAppStore.getState();
  const enStage3Project = stage3FocusedState.projects[importedEnStage3ProjectId];
  assert.ok(enStage3Project, 'en stage 3 import should create a career case project');
  assert.match(enStage3Project.title, /Stage 3|Career Transition Case/i);
  const stage3Project = stage3FocusedState.projects[importedEnStage3ProjectId];
  const stage3Context = stage3FocusedState.contexts[stage3Project.active_context_id];
  assert.equal(stage3FocusedState.isNodeSelectionMode, true, 'stage 3 should enter selection mode');
  assert.equal(stage3FocusedState.nodeSelectionIntent, 'delete', 'stage 3 should be a delete-selection snapshot');
  assert.ok(stage3FocusedState.selectedNodeIds.length >= 2, 'stage 3 should preselect tangent nodes for deletion');
  assert.ok(stage3Context.excluded_nodes.length >= 3, 'stage 3 should already have analyst baggage excluded');

  const excludedText = stage3Context.excluded_nodes.map((nodeId) => stage3FocusedState.nodes[nodeId]?.content || '').join('\n');
  assert.match(excludedText, /Python web scraping|data cleaning|SQL/i, 'excluded nodes should capture the technical baggage');

  const importedEnStage4ProjectId = useAppStore.getState().importCareerCaseProject('stage4', 'en');
  const stage4FocusedState = useAppStore.getState();
  const enStage4Project = stage4FocusedState.projects[importedEnStage4ProjectId];
  assert.ok(enStage4Project, 'en stage 4 import should create a career case project');
  assert.match(enStage4Project.title, /Stage 4|Career Transition Case/i);
  const stage4Project = stage4FocusedState.projects[importedEnStage4ProjectId];
  const stage4Context = stage4FocusedState.contexts[stage4Project.active_context_id];
  assert.equal(stage4FocusedState.isNodeSelectionMode, false, 'stage 4 should clear selection mode');
  const enabledTaskSopId = stage4Context.enabled_patterns_by_type.task_sop;
  assert.ok(enabledTaskSopId, 'stage 4 should enable a Task SOP pattern');
  const taskSop = enabledTaskSopId ? stage4FocusedState.patterns[enabledTaskSopId] : null;
  assert.ok(taskSop, 'enabled Task SOP should exist in the pattern library');
  assert.equal(taskSop?.review_status, 'approved');
  assert.match(taskSop?.name || '', /STAR|Career|Interview/i);

  const stage4Nodes = Object.values(stage4FocusedState.nodes).filter((node) => node.project_id === importedEnStage4ProjectId);
  const stage4Mainline = stage4FocusedState.mainlines[importedEnStage4ProjectId] || [];
  assert.ok(stage4Mainline.length >= 8, 'stage 4 should include a full PM-oriented mainline');
  const stage3Nodes = Object.values(stage3FocusedState.nodes).filter((node) => node.project_id === importedEnStage3ProjectId);
  assert.equal(stage3Nodes.some((node) => node.metadata.is_delete_placeholder), false, 'stage 3 should show tangent deletion before the nodes are deleted');

  const combinedText = stage4Nodes.map((node) => node.content).join('\n');
  assert.match(combinedText, /stakeholder alignment|prioritization|roadmap/i);
  assert.match(combinedText, /STAR/i);

  console.log('Import career case tests passed.');
};

await run();
