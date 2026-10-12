import type { ContextView } from '../types';

const STORAGE_KEY = 'context-map.context-plan-edits.v1';
const PROPOSAL_STORAGE_KEY = 'context-map.context-plan-proposals.v1';
const TURN_STORAGE_KEY = 'context-map.context-turn-plans.v1';
const USER_KEY = 'context-map.active-user-id';
const MAX_EVENTS_PER_USER = 1000;

export type ContextTurnPlan = {
  user_id: string;
  project_id: string;
  turn_node_id: string;
  query: string;
  context_plan: PlanSnapshot;
  selected_node_ids: string[];
  captured_at: string;
};

type PlanSnapshot = Pick<ContextView, 'base_path' | 'included_nodes' | 'excluded_nodes'>;

export type ContextPlanEditEvent = {
  event_id: string;
  user_id: string;
  project_id: string;
  context_id: string;
  action: 'node_cycle' | 'batch_scope_edit' | 'branch_open_manual' | 'branch_open_accept' | 'route_return_mainline' | 'route_return_parent';
  touched_node_ids: string[];
  before: PlanSnapshot;
  after: PlanSnapshot;
  captured_at: string;
};

export const readContextPlanEdits = (storage: Pick<Storage, 'getItem'>, userId: string): ContextPlanEditEvent[] => {
  try {
    const byUser = JSON.parse(storage.getItem(STORAGE_KEY) || '{}') as Record<string, ContextPlanEditEvent[]>;
    return Array.isArray(byUser[userId]) ? byUser[userId].slice(-MAX_EVENTS_PER_USER) : [];
  } catch { return []; }
};

const snapshot = (context: ContextView): PlanSnapshot => ({
  base_path: context.base_path,
  included_nodes: [...context.included_nodes],
  excluded_nodes: [...context.excluded_nodes],
});

/** Records the exact graph selection used at a turn, before the model replies. */
export const recordContextTurnPlan = (input: {
  projectId: string;
  turnNodeId: string;
  query: string;
  context: ContextView;
  selectedNodeIds: string[];
}) => {
  if (typeof window === 'undefined') return;
  try {
    const storage = window.localStorage;
    const userId = storage.getItem(USER_KEY)?.trim() || 'local-anonymous';
    const byUser = JSON.parse(storage.getItem(TURN_STORAGE_KEY) || '{}') as Record<string, ContextTurnPlan[]>;
    const rows = Array.isArray(byUser[userId]) ? byUser[userId] : [];
    if (rows.some((row) => row.turn_node_id === input.turnNodeId)) return;
    byUser[userId] = [...rows, {
      user_id: userId,
      project_id: input.projectId,
      turn_node_id: input.turnNodeId,
      query: input.query,
      context_plan: snapshot(input.context),
      selected_node_ids: [...new Set(input.selectedNodeIds)],
      captured_at: new Date().toISOString(),
    }].slice(-MAX_EVENTS_PER_USER);
    storage.setItem(TURN_STORAGE_KEY, JSON.stringify(byUser));
  } catch { /* A storage failure must not prevent a chat turn. */ }
};

export const readContextTurnPlans = (storage: Pick<Storage, 'getItem'>, userId: string): ContextTurnPlan[] => {
  try {
    const byUser = JSON.parse(storage.getItem(TURN_STORAGE_KEY) || '{}') as Record<string, ContextTurnPlan[]>;
    return Array.isArray(byUser[userId]) ? byUser[userId] : [];
  } catch { return []; }
};

export const logContextPlanEdit = (input: {
  projectId: string;
  before: ContextView | undefined;
  after: ContextView | undefined;
  touchedNodeIds: string[];
  action: 'node_cycle' | 'batch_scope_edit' | 'branch_open_manual' | 'branch_open_accept'
    | 'route_return_mainline' | 'route_return_parent';
}) => {
  if (typeof window === 'undefined' || !input.before || !input.after) return;
  const before = snapshot(input.before);
  const after = snapshot(input.after);
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  try {
    const storage = window.localStorage;
    const userId = storage.getItem(USER_KEY)?.trim() || 'local-anonymous';
    const byUser = JSON.parse(storage.getItem(STORAGE_KEY) || '{}') as Record<string, unknown[]>;
    const rows = Array.isArray(byUser[userId]) ? byUser[userId] : [];
    byUser[userId] = [...rows, {
      event_id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `context-edit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      user_id: userId,
      project_id: input.projectId,
      context_id: input.after.context_id,
      action: input.action,
      touched_node_ids: [...input.touchedNodeIds],
      before,
      after,
      captured_at: new Date().toISOString(),
    }].slice(-MAX_EVENTS_PER_USER);
    storage.setItem(STORAGE_KEY, JSON.stringify(byUser));
  } catch {
    // Logging must not interrupt a user's context edit.
  }
};

export const logContextPlanProposal = (input: {
  suggestionId: string;
  projectId: string;
  context: ContextView | undefined;
  phase: 'created' | 'shown' | 'accepted' | 'rejected' | 'ignored' | 'expired';
  originBasePath: string;
  anchorNodeId: string;
  movedNodeIds: readonly string[];
}) => {
  if (typeof window === 'undefined' || !input.context || !input.suggestionId) return;
  try {
    const storage = window.localStorage;
    const userId = storage.getItem(USER_KEY)?.trim() || 'local-anonymous';
    const byUser = JSON.parse(storage.getItem(PROPOSAL_STORAGE_KEY) || '{}') as Record<string, unknown[]>;
    const rows = Array.isArray(byUser[userId]) ? byUser[userId] : [];
    const exists = rows.some((row) => {
      if (!row || typeof row !== 'object') return false;
      const event = row as Record<string, unknown>;
      return event.suggestion_id === input.suggestionId && event.phase === input.phase;
    });
    if (exists) return;
    byUser[userId] = [...rows, {
      suggestion_id: input.suggestionId,
      phase: input.phase,
      user_id: userId,
      project_id: input.projectId,
      context_id: input.context.context_id,
      candidate: {
        route: 'open',
        origin_base_path: input.originBasePath,
        anchor_node_id: input.anchorNodeId,
        moved_node_ids: [...input.movedNodeIds],
      },
      context_plan: snapshot(input.context),
      captured_at: new Date().toISOString(),
    }].slice(-MAX_EVENTS_PER_USER);
    storage.setItem(PROPOSAL_STORAGE_KEY, JSON.stringify(byUser));
  } catch {
    // Research logging must not interrupt a user's branch action.
  }
};
