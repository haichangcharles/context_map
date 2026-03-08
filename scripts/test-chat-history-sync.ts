import assert from 'node:assert/strict';
import {
  reconstructChatStateFromRecords,
  mergeRecoveredChatState,
  type ChatHistoryRecord,
  type RecoveredChatState,
} from '../src/services/chatHistory';
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
];

const run = () => {
  const recovered = reconstructChatStateFromRecords(records);

  assert.equal(Object.keys(recovered.projects).length, 1);
  assert.equal(recovered.projects['project-1']?.root_node_id, 'm1');
  assert.equal(recovered.projects['project-1']?.title, 'Stored Project Title');
  assert.deepEqual(recovered.mainlines['project-1'], ['m1', 'm2']);
  assert.deepEqual(recovered.naturalMainlines['project-1'], ['m1', 'm2']);
  assert.equal(recovered.nodes['b1']?.branch_id, 'branch-1');
  assert.equal(recovered.branches['branch-1']?.anchor_node_id, 'm2');
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
      activeProjectId: null,
    },
    recovered
  );

  assert.equal(merged.projects['project-1']?.title, 'Local title wins');
  assert.equal(merged.nodes['m1']?.content, 'Local content wins');
  assert.equal(merged.nodes['m2']?.content, 'Mainline answer');
  assert.equal(merged.branches['branch-1']?.anchor_node_id, 'm2');
  assert.deepEqual(merged.mainlines['project-1'], ['m1', 'm2']);

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
