import type { Branch, ContextView, Node } from '../types';

export type ContextPlanEditEvidence = {
  action: string;
  before: Pick<ContextView, 'base_path' | 'included_nodes' | 'excluded_nodes'>;
  after: Pick<ContextView, 'base_path' | 'included_nodes' | 'excluded_nodes'>;
};

export type ContextGraph = {
  nodes: Record<string, Node>;
  branches: Record<string, Branch>;
  children: Record<string, string[]>;
  branchNodes: Record<string, string[]>;
  nodeTerms: Record<string, string[]>;
  branchTerms: Record<string, string[]>;
  invertedIndex: Record<string, string[]>;
};

export type ContextChoice = {
  query: string;
  branchId: string;
  decision: 'accepted' | 'rejected';
  at: string;
};

export type ContextPreference = {
  evidenceCount: number;
  acceptanceRate: number;
  preferredTerms: string[];
  branchAffinity: Record<string, number>;
  minimumScore: number;
  manualIncludeCount: number;
  manualExcludeCount: number;
};

export type ContextProposal = {
  proposalId: string;
  contextFingerprint: string;
  branchId: string;
  nodeIds: string[];
  label: string;
  reason: string;
  score: number;
};

export const fingerprintContextPlan = (context: ContextView): string => JSON.stringify([
  context.context_id,
  context.base_path,
  [...context.included_nodes].sort(),
  [...context.excluded_nodes].sort(),
]);

/** An accepted suggestion may mutate only the exact plan that was reviewed. */
export const reviewContextProposal = (input: {
  proposal: ContextProposal;
  context: ContextView;
  graph: ContextGraph;
}): { valid: boolean; nodeIds: string[]; reason?: string } => {
  if (fingerprintContextPlan(input.context) !== input.proposal.contextFingerprint) {
    return { valid: false, nodeIds: [], reason: 'Context changed. Review a new suggestion.' };
  }
  const validIds = input.proposal.nodeIds.filter((id) =>
    input.graph.nodes[id]?.branch_id === input.proposal.branchId &&
    !input.context.excluded_nodes.includes(id)
  );
  if (validIds.length !== input.proposal.nodeIds.length || !validIds.length) {
    return { valid: false, nodeIds: [], reason: 'Branch material changed. Review a new suggestion.' };
  }
  return { valid: true, nodeIds: validIds };
};

export type CompiledTurnContext = {
  nodes: Node[];
  sources: Record<string, 'active_path' | 'explicit_include'>;
  excludedNodeIds: string[];
};

/** One deterministic boundary between the visible graph and the model request. */
export const compileTurnContext = (input: {
  graph: ContextGraph;
  context: ContextView;
  visibleNodeIds: string[];
}): CompiledTurnContext => {
  const excluded = new Set(input.context.excluded_nodes);
  const sources: CompiledTurnContext['sources'] = {};
  const selected = new Map<string, Node>();
  for (const id of input.visibleNodeIds) {
    const node = input.graph.nodes[id];
    if (node && !excluded.has(id)) { selected.set(id, node); sources[id] = 'active_path'; }
  }
  for (const id of input.context.included_nodes) {
    const node = input.graph.nodes[id];
    if (node && !excluded.has(id)) { selected.set(id, node); sources[id] = 'explicit_include'; }
  }
  return {
    nodes: [...selected.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.node_id.localeCompare(b.node_id)),
    sources,
    excludedNodeIds: input.context.excluded_nodes.filter((id) => Boolean(input.graph.nodes[id])),
  };
};

const STOP = new Set(['this', 'that', 'with', 'from', 'have', 'what', 'when', 'then', 'about', 'into', 'your', 'the', 'and', 'for', 'can', 'you', 'are', 'our', 'now', 'here', 'need', 'please', 'using', 'branch', 'mainline', 'node', 'include', 'context', '需要', '可以', '这个', '我们', '然后', '一下', '继续', '分支', '上下']);

export const contextTerms = (value: string): string[] => {
  const normalized = value.toLowerCase();
  const latin = normalized.match(/[a-z0-9]{3,}/g) || [];
  const han = normalized.match(/[\u3400-\u9fff]{2,}/g) || [];
  const bigrams = han.flatMap((word) => Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2)));
  return [...new Set([...latin, ...bigrams].filter((term) => !STOP.has(term)))];
};

/** A typed conversation graph. Parent, branch and anchor edges are kept separate. */
export const buildContextGraph = (projectId: string, nodes: Record<string, Node>, branches: Record<string, Branch>): ContextGraph => {
  const projectNodes = Object.fromEntries(Object.values(nodes).filter((node) => node.project_id === projectId).map((node) => [node.node_id, node]));
  const projectBranches = Object.fromEntries(Object.values(branches).filter((branch) => branch.project_id === projectId).map((branch) => [branch.branch_id, branch]));
  const children: Record<string, string[]> = {};
  const branchNodes: Record<string, string[]> = {};
  const nodeTerms: Record<string, string[]> = {};
  const branchTerms: Record<string, string[]> = {};
  const invertedIndex: Record<string, string[]> = {};
  for (const node of Object.values(projectNodes)) {
    nodeTerms[node.node_id] = contextTerms(node.content);
    for (const term of nodeTerms[node.node_id]) (invertedIndex[term] ||= []).push(node.node_id);
    if (node.parent_id && projectNodes[node.parent_id]) (children[node.parent_id] ||= []).push(node.node_id);
    if (node.branch_id && projectBranches[node.branch_id]) (branchNodes[node.branch_id] ||= []).push(node.node_id);
  }
  for (const branch of Object.values(projectBranches)) {
    branchTerms[branch.branch_id] = contextTerms(`${branch.intent_summary || ''} ${branch.branch_summary || ''}`);
  }
  for (const ids of Object.values(branchNodes)) ids.sort((a, b) => projectNodes[a].timestamp.localeCompare(projectNodes[b].timestamp));
  return { nodes: projectNodes, branches: projectBranches, children, branchNodes, nodeTerms, branchTerms, invertedIndex };
};

export const learnContextPreference = (choices: ContextChoice[], edits: ContextPlanEditEvidence[] = []): ContextPreference => {
  const recent = choices.slice(-30);
  const accepted = recent.filter((choice) => choice.decision === 'accepted');
  const manual = edits.slice(-100).filter((edit) => edit.action === 'node_cycle' || edit.action === 'batch_scope_edit');
  const manualIncludeCount = manual.reduce((sum, edit) => sum + edit.after.included_nodes.filter((id) => !edit.before.included_nodes.includes(id)).length, 0);
  const manualExcludeCount = manual.reduce((sum, edit) => sum + edit.after.excluded_nodes.filter((id) => !edit.before.excluded_nodes.includes(id)).length, 0);
  const positive = accepted.length + manualIncludeCount;
  const total = recent.length + manualIncludeCount + manualExcludeCount;
  const acceptanceRate = total ? positive / total : 0.5;
  const counts = new Map<string, number>();
  const branchAffinity: Record<string, number> = {};
  for (const choice of accepted) for (const term of contextTerms(choice.query)) counts.set(term, (counts.get(term) || 0) + 1);
  for (const choice of recent) branchAffinity[choice.branchId] = Math.max(-2, Math.min(2, (branchAffinity[choice.branchId] || 0) + (choice.decision === 'accepted' ? 1 : -1)));
  return {
    evidenceCount: total,
    acceptanceRate,
    preferredTerms: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([term]) => term),
    branchAffinity,
    minimumScore: total < 3 ? 0.29 : Math.max(0.22, Math.min(0.46, 0.38 - (acceptanceRate - 0.5) * 0.24)),
    manualIncludeCount,
    manualExcludeCount,
  };
};

const overlap = (query: Set<string>, terms: string[]): number => {
  if (!query.size || !terms.length) return 0;
  const matched = terms.filter((term) => query.has(term)).length;
  return (matched / query.size) * (0.75 + 0.25 * Math.min(1, 12 / terms.length));
};

/** Suggests old branch material for the next turn; never edits the plan itself. */
export const proposeContextReturns = (input: {
  graph: ContextGraph;
  context: ContextView;
  query: string;
  activeNodeIds: string[];
  choices?: ContextChoice[];
  planEdits?: ContextPlanEditEvidence[];
  maxProposals?: number;
}): ContextProposal[] => {
  const query = new Set(contextTerms(input.query));
  if (query.size < 2) return [];
  const active = new Set(input.activeNodeIds);
  const explicit = new Set([...input.context.included_nodes, ...input.context.excluded_nodes]);
  const preference = learnContextPreference(input.choices || [], input.planEdits || []);
  const matchingNodeIds = new Set([...query].flatMap((term) => input.graph.invertedIndex[term] || []));
  const proposals: ContextProposal[] = [];
  for (const branch of Object.values(input.graph.branches)) {
    if (branch.branch_id === input.context.base_path) continue;
    const candidates = (input.graph.branchNodes[branch.branch_id] || [])
      .filter((id) => matchingNodeIds.has(id))
      .map((id) => input.graph.nodes[id])
      .filter((node) => node && node.content.trim() && !active.has(node.node_id) && !explicit.has(node.node_id));
    if (!candidates.length) continue;
    const label = branch.intent_summary || branch.branch_summary || input.graph.nodes[branch.anchor_node_id]?.content || 'Earlier branch';
    const branchMatch = overlap(query, input.graph.branchTerms[branch.branch_id] || []);
    const ranked = candidates.map((node) => ({ node, match: overlap(query, input.graph.nodeTerms[node.node_id] || []) }))
      .sort((a, b) => b.match - a.match || b.node.timestamp.localeCompare(a.node.timestamp));
    const best = ranked[0];
    const personal = (preference.evidenceCount >= 3 && preference.preferredTerms.some((term) => query.has(term)) ? 0.03 : 0)
      + (preference.branchAffinity[branch.branch_id] || 0) * 0.03;
    const score = Math.min(1, 0.62 * best.match + 0.38 * branchMatch + personal);
    if (score < preference.minimumScore) continue;
    const selected = new Set(ranked.filter((item) => item.match >= Math.max(0.2, best.match * 0.62)).slice(0, 2).map((item) => item.node.node_id));
    for (const id of [...selected]) {
      const node = input.graph.nodes[id];
      const pairId = node.role === 'assistant'
        ? node.parent_id
        : (input.graph.children[id] || []).find((childId) => input.graph.nodes[childId]?.role === 'assistant');
      if (pairId && input.graph.nodes[pairId]?.branch_id === branch.branch_id && !active.has(pairId) && !explicit.has(pairId)) selected.add(pairId);
    }
    const selectedIds = [...selected].sort((a, b) => input.graph.nodes[a].timestamp.localeCompare(input.graph.nodes[b].timestamp));
    proposals.push({
      proposalId: `${input.context.context_id}:${branch.branch_id}:${selectedIds.join(',')}`,
      contextFingerprint: fingerprintContextPlan(input.context),
      branchId: branch.branch_id,
      nodeIds: selectedIds,
      label: label.replace(/\s+/g, ' ').slice(0, 90),
      reason: `This turn matches material from an earlier branch. Bring ${selectedIds.length} message${selectedIds.length === 1 ? '' : 's'} into the next reply?`,
      score,
    });
  }
  return proposals.sort((a, b) => b.score - a.score || a.branchId.localeCompare(b.branchId)).slice(0, input.maxProposals || 2);
};
