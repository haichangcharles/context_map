import assert from 'node:assert/strict';
import type { Branch, ContextView, Node } from '../src/types';
import { buildContextGraph, compileTurnContext, learnContextPreference, proposeContextReturns, reviewContextProposal } from '../src/domain/contextSteward';

const node = (id: string, content: string, branchId: string | null, time: number): Node => ({
  node_id: id, project_id: 'writing', parent_id: time ? `n${time - 1}` : null,
  role: 'user', content, branch_id: branchId, timestamp: new Date(2026, 0, 1, 0, time).toISOString(), metadata: {},
});
const nodes: Record<string, Node> = {
  n0: node('n0', 'Plan an article about AI agents and evidence', null, 0),
  n1: node('n1', 'Let us explore alternatives before settling on a direction', 'brainstorm', 1),
  n2: { ...node('n2', 'The interviews support the human agency argument in the article', 'brainstorm', 2), role: 'assistant' },
  n3: node('n3', 'Book a hotel for the conference', 'travel', 3),
  n4: node('n4', 'Now write the next section of the article', null, 4),
};
const branches: Record<string, Branch> = {
  brainstorm: { branch_id: 'brainstorm', project_id: 'writing', anchor_node_id: 'n0', parent_branch_id: null, status: 'inactive', intent_summary: 'Brainstorm interview evidence for the AI agent article' },
  travel: { branch_id: 'travel', project_id: 'writing', anchor_node_id: 'n2', parent_branch_id: null, status: 'inactive', intent_summary: 'Travel booking' },
};
const context: ContextView = { context_id: 'c', project_id: 'writing', base_path: 'mainline', included_nodes: [], excluded_nodes: [], enabled_patterns_by_type: {} };
const graph = buildContextGraph('writing', nodes, branches);
assert.deepEqual(graph.branchNodes.brainstorm, ['n1', 'n2']);

const initial = compileTurnContext({ graph, context, visibleNodeIds: ['n0', 'n4'] });
assert.deepEqual(initial.nodes.map((item) => item.node_id), ['n0', 'n4']);
const recalled = compileTurnContext({ graph, context: { ...context, included_nodes: ['n2', 'n2'] }, visibleNodeIds: ['n0', 'n4'] });
assert.deepEqual(recalled.nodes.map((item) => item.node_id), ['n0', 'n2', 'n4'], 'old material should enter only the chosen turn and should be deduplicated');
assert.equal(recalled.sources.n2, 'explicit_include');
const excluded = compileTurnContext({ graph, context: { ...context, included_nodes: ['n2'], excluded_nodes: ['n2'] }, visibleNodeIds: ['n0', 'n4'] });
assert.deepEqual(excluded.nodes.map((item) => item.node_id), ['n0', 'n4'], 'explicit exclude must take priority even if stale state contains the same include');

const query = 'Write the article section using the interview evidence about human agency';
const first = proposeContextReturns({ graph, context, query, activeNodeIds: ['n0', 'n4'] });
assert.equal(first[0]?.branchId, 'brainstorm', 'the old brainstorming branch should return at a later writing turn');
assert.ok(first[0].nodeIds.includes('n2'));
assert.ok(first[0].nodeIds.includes('n1'), 'an assistant conclusion should bring its user question when safe');
assert.ok(!first.some((proposal) => proposal.branchId === 'travel'));
assert.deepEqual(reviewContextProposal({ proposal: first[0], context, graph }).nodeIds, first[0].nodeIds);
assert.equal(reviewContextProposal({ proposal: first[0], context: { ...context, excluded_nodes: ['n1'] }, graph }).valid, false, 'an old card cannot overwrite a newer plan');

const afterInclude = proposeContextReturns({ graph, context: { ...context, included_nodes: first[0].nodeIds }, query, activeNodeIds: ['n0', 'n4', ...first[0].nodeIds] });
assert.ok(!afterInclude.some((proposal) => proposal.branchId === 'brainstorm'), 'accepted evidence must not be suggested again');
const directExclude = proposeContextReturns({ graph, context: { ...context, excluded_nodes: ['n1', 'n2'] }, query, activeNodeIds: ['n0', 'n4'] });
assert.ok(!directExclude.some((proposal) => proposal.branchId === 'brainstorm'), 'explicit exclusions must remain protected');

const preference = learnContextPreference([
  { query, branchId: 'brainstorm', decision: 'accepted', at: '2026-01-01' },
  { query, branchId: 'brainstorm', decision: 'accepted', at: '2026-01-02' },
  { query, branchId: 'brainstorm', decision: 'rejected', at: '2026-01-03' },
]);
assert.equal(preference.evidenceCount, 3);
assert.ok(preference.preferredTerms.includes('interview'));
assert.equal(preference.branchAffinity.brainstorm, 1);
assert.ok(preference.minimumScore < learnContextPreference(Array.from({ length: 3 }, (_, i) => ({ query, branchId: 'brainstorm', decision: 'rejected' as const, at: `2026-01-0${i + 1}` }))).minimumScore);
const manualPreference = learnContextPreference([], [{
  action: 'batch_scope_edit',
  before: { base_path: 'mainline', included_nodes: [], excluded_nodes: [] },
  after: { base_path: 'mainline', included_nodes: ['n1', 'n2'], excluded_nodes: [] },
}]);
assert.equal(manualPreference.manualIncludeCount, 2, 'manual edits must provide cold-start preference evidence');
assert.equal(manualPreference.evidenceCount, 2);
console.log('Context steward graph, retrieval, explicit-plan protection, and preference learning passed.');
