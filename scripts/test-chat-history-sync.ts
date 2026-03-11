import assert from 'node:assert/strict';
import {
  reconstructChatStateFromRecords,
  mergeRecoveredChatState,
  type ChatHistoryRecord,
  type RecoveredChatState,
} from '../src/services/chatHistory';
import { mergeRecoveredChatStateIntoStore, useAppStore } from '../src/store';
import type { Branch, ContextView, Node, Pattern, Project } from '../src/types';

const records: ChatHistoryRecord[] = [
  {
    message_id: 'm1',
    user_id: 'user-1',
    project_id: 'project-1',
    project_title: 'Stored Project Title',
    parent_id: null,
    branch_id: null,
    role: 'user',
    content: 'Start project',
    message_timestamp: '2026-03-06T10:00:00.000Z',
    captured_at: '2026-03-06T10:00:01.000Z',
  },
  {
    message_id: 'm2',
    user_id: 'user-1',
    project_id: 'project-1',
    project_title: 'Stored Project Title',
    parent_id: 'm1',
    branch_id: null,
    role: 'assistant',
    content: 'Mainline answer',
    message_timestamp: '2026-03-06T10:00:02.000Z',
    captured_at: '2026-03-06T10:00:03.000Z',
  },
  {
    message_id: 'b1',
    user_id: 'user-1',
    project_id: 'project-1',
    project_title: 'Stored Project Title',
    parent_id: 'm2',
    branch_id: 'branch-1',
    role: 'user',
    content: 'Branch question',
    message_timestamp: '2026-03-06T10:01:00.000Z',
    captured_at: '2026-03-06T10:01:01.000Z',
  },
  {
    message_id: 'b2',
    user_id: 'user-1',
    project_id: 'project-1',
    project_title: 'Stored Project Title',
    parent_id: 'b1',
    branch_id: 'branch-1',
    role: 'assistant',
    content: 'Branch answer',
    message_timestamp: '2026-03-06T10:01:02.000Z',
    captured_at: '2026-03-06T10:01:03.000Z',
  },
  {
    message_id: 'context-map-delete:m2',
    user_id: 'user-1',
    project_id: 'project-1',
    project_title: 'Stored Project Title',
    parent_id: null,
    branch_id: null,
    role: 'system',
    content: '[context-map-delete] m2',
    message_timestamp: '2026-03-06T10:02:00.000Z',
    captured_at: '2026-03-06T10:02:01.000Z',
  },
  {
    message_id: 'context-map-rename:project-1:2026-03-06T10:03:00.000Z',
    user_id: 'user-1',
    project_id: 'project-1',
    project_title: 'Renamed Project Title',
    parent_id: null,
    branch_id: null,
    role: 'system',
    content: '[context-map-project-rename] Renamed Project Title',
    message_timestamp: '2026-03-06T10:03:00.000Z',
    captured_at: '2026-03-06T10:03:01.000Z',
  },
];

const run = () => {
  const recovered = reconstructChatStateFromRecords(records);

  assert.equal(Object.keys(recovered.projects).length, 1);
  assert.equal(recovered.projects['project-1']?.root_node_id, 'm1');
  assert.equal(recovered.projects['project-1']?.title, 'Renamed Project Title');
  assert.deepEqual(recovered.mainlines['project-1'], ['m1']);
  assert.deepEqual(recovered.naturalMainlines['project-1'], ['m1']);
  assert.deepEqual(recovered.deletedNodeIds, ['m2']);
  assert.ok(!recovered.nodes['m2'], 'remote tombstone should remove deleted node during reconstruction');
  assert.ok(!recovered.nodes['context-map-rename:project-1:2026-03-06T10:03:00.000Z'], 'rename markers should not become visible nodes');
  assert.equal(recovered.nodes['b1']?.branch_id, 'branch-1');
  assert.equal(recovered.branches['branch-1']?.anchor_node_id, 'm1');
  assert.equal(recovered.branches['branch-1']?.parent_branch_id, null);

  const contextId = recovered.projects['project-1']?.active_context_id as string;
  assert.equal(recovered.contexts[contextId]?.project_id, 'project-1');
  assert.equal(recovered.contexts[contextId]?.base_path, 'mainline');

  const merged = mergeRecoveredChatState(
    {
      projects: {
        'project-1': {
          ...recovered.projects['project-1'],
          title: 'Local title wins',
        },
      } as Record<string, Project>,
      nodes: {
        m1: {
          ...recovered.nodes['m1'],
          content: 'Local content wins',
        },
      } as Record<string, Node>,
      branches: {} as Record<string, Branch>,
      mainlines: {} as Record<string, string[]>,
      contexts: {} as Record<string, ContextView>,
      patterns: {} as Record<string, Pattern>,
      pastStructureSnapshots: [],
      futureStructureSnapshots: [],
      naturalMainlines: {},
      naturalBranches: {},
      deletedNodeIds: [],
      activeProjectId: null,
    },
    recovered
  );

  assert.equal(merged.projects['project-1']?.title, 'Local title wins');
  assert.equal(merged.nodes['m1']?.content, 'Local content wins');
  assert.equal(merged.nodes['m2'], undefined);
  assert.equal(merged.branches['branch-1']?.anchor_node_id, 'm1');
  assert.deepEqual(merged.mainlines['project-1'], ['m1']);

  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    deletedNodeIds: ['m2'],
  });
  mergeRecoveredChatStateIntoStore(recovered);
  const mergedIntoStore = useAppStore.getState();
  assert.ok(!mergedIntoStore.nodes['m2'], 'store merge should not resurrect locally deleted nodes from remote history');
  assert.ok(!(mergedIntoStore.mainlines['project-1'] || []).includes('m2'), 'filtered remote merge should not put deleted nodes back into mainline');
  assert.deepEqual(mergedIntoStore.deletedNodeIds, ['m2'], 'deleted tombstones should remain after remote merge');

  useAppStore.setState(useAppStore.getInitialState(), true);
  mergeRecoveredChatStateIntoStore(recovered);
  const remoteDeletionMerged = useAppStore.getState();
  assert.ok(!remoteDeletionMerged.nodes['m2'], 'remote tombstones should prevent deleted nodes from being restored into a fresh store');
  assert.deepEqual(remoteDeletionMerged.deletedNodeIds, ['m2'], 'remote tombstones should hydrate deleted ids into store state');

  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    projects: {
      'project-1': recovered.projects['project-1'],
    },
    nodes: {
      m1: recovered.nodes['m1'],
      b1: recovered.nodes['b1'],
      b2: recovered.nodes['b2'],
    },
    branches: recovered.branches,
    mainlines: recovered.mainlines,
    contexts: recovered.contexts,
    naturalMainlines: recovered.naturalMainlines,
    naturalBranches: recovered.naturalBranches,
    activeProjectId: 'project-1',
    deletedNodeIds: [],
  });
  useAppStore.getState().deleteProject('project-1');
  const afterProjectDelete = useAppStore.getState();
  assert.equal(afterProjectDelete.projects['project-1'], undefined, 'local delete should remove the project immediately');
  assert.deepEqual(
    new Set(afterProjectDelete.deletedNodeIds),
    new Set(['m1', 'b1', 'b2']),
    'project delete should retain tombstones for every deleted node'
  );
  mergeRecoveredChatStateIntoStore(reconstructChatStateFromRecords(records));
  const afterRemoteMerge = useAppStore.getState();
  assert.equal(afterRemoteMerge.projects['project-1'], undefined, 'stale remote history should not restore a locally deleted project');

  const fallbackRecovered = reconstructChatStateFromRecords([
    {
      message_id: 'legacy-1',
      user_id: 'user-1',
      project_id: 'legacy-project',
      parent_id: null,
      branch_id: null,
      role: 'user',
      content: 'Legacy project without stored title',
      message_timestamp: '2026-03-06T11:00:00.000Z',
      captured_at: '2026-03-06T11:00:01.000Z',
    },
  ]);

  assert.equal(fallbackRecovered.projects['legacy-project']?.title, 'Recovered legacy-p');

  console.log('Chat history sync tests passed.');
};

run();
