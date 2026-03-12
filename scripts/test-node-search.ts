import assert from 'node:assert/strict';
import { getProjectNodeSearchResults, normalizeNodeSearchQuery, stepNodeSearchIndex } from '../src/utils/nodeSearch';
import type { Node } from '../src/types';

const nodes: Record<string, Node> = {
  a: {
    node_id: 'a',
    project_id: 'project-1',
    parent_id: null,
    role: 'user',
    content: 'Search this Alpha branch note',
    branch_id: null,
    timestamp: '2026-03-12T10:00:00.000Z',
    metadata: {},
  },
  b: {
    node_id: 'b',
    project_id: 'project-1',
    parent_id: 'a',
    role: 'assistant',
    content: 'Another alpha result appears here',
    branch_id: 'branch-1',
    timestamp: '2026-03-12T10:01:00.000Z',
    metadata: {},
  },
  c: {
    node_id: 'c',
    project_id: 'project-2',
    parent_id: null,
    role: 'user',
    content: 'Alpha in a different project should not match',
    branch_id: null,
    timestamp: '2026-03-12T10:02:00.000Z',
    metadata: {},
  },
  d: {
    node_id: 'd',
    project_id: 'project-1',
    parent_id: 'b',
    role: 'assistant',
    content: 'beta only',
    branch_id: 'branch-1',
    timestamp: '2026-03-12T10:03:00.000Z',
    metadata: {},
  },
};

const run = () => {
  assert.equal(normalizeNodeSearchQuery('  Alpha   branch  '), 'alpha branch');

  const alphaResults = getProjectNodeSearchResults(nodes, 'project-1', 'alpha');
  assert.deepEqual(alphaResults, ['a', 'b']);

  const phraseResults = getProjectNodeSearchResults(nodes, 'project-1', 'Alpha branch');
  assert.deepEqual(phraseResults, ['a']);

  const noResults = getProjectNodeSearchResults(nodes, 'project-1', 'gamma');
  assert.deepEqual(noResults, []);

  assert.equal(stepNodeSearchIndex(-1, 3, 'next'), 0);
  assert.equal(stepNodeSearchIndex(-1, 3, 'prev'), 2);
  assert.equal(stepNodeSearchIndex(0, 3, 'next'), 1);
  assert.equal(stepNodeSearchIndex(2, 3, 'next'), 0);
  assert.equal(stepNodeSearchIndex(0, 3, 'prev'), 2);
  assert.equal(stepNodeSearchIndex(1, 3, 'prev'), 0);

  console.log('Node search tests passed.');
};

run();
