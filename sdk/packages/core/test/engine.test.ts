import { describe, expect, it } from 'vitest';
import { ContextMapEngine } from '../src/engine';

describe('ContextMapEngine', () => {
  it('creates project and appends mainline nodes', () => {
    const engine = new ContextMapEngine({
      idGenerator: (() => {
        let i = 0;
        return () => `id_${++i}`;
      })(),
      now: () => '2026-01-01T00:00:00.000Z',
    });

    const projectId = engine.createProject('SDK Test');
    const first = engine.addNode({
      projectId,
      parentId: null,
      role: 'user',
      content: 'hello',
      branchId: null,
    });

    const second = engine.addNode({
      projectId,
      parentId: first,
      role: 'assistant',
      content: 'world',
      branchId: null,
    });

    const state = engine.getState();
    expect(state.mainlines[projectId]).toEqual([first, second]);
    expect(state.projects[projectId]?.root_node_id).toBe(first);
  });

  it('creates branch and can promote branch nodes to mainline', () => {
    const engine = new ContextMapEngine({
      idGenerator: (() => {
        let i = 0;
        return () => `id_${++i}`;
      })(),
      now: (() => {
        let i = 0;
        return () => new Date(2026, 0, 1, 0, 0, i++).toISOString();
      })(),
    });

    const projectId = engine.createProject('Branch Test');
    const n1 = engine.addNode({ projectId, parentId: null, role: 'user', content: 'n1', branchId: null });
    const n2 = engine.addNode({ projectId, parentId: n1, role: 'assistant', content: 'n2', branchId: null });
    const n3 = engine.addNode({ projectId, parentId: n2, role: 'user', content: 'n3', branchId: null });

    const branchId = engine.createBranch(projectId, n2);
    const b1 = engine.addNode({ projectId, parentId: n2, role: 'assistant', content: 'b1', branchId });
    const b2 = engine.addNode({ projectId, parentId: b1, role: 'user', content: 'b2', branchId });

    engine.promoteBranch(projectId, branchId);

    const state = engine.getState();
    expect(state.mainlines[projectId]).toEqual([n1, n2, b1, b2]);
    expect(state.nodes[b1]?.branch_id).toBeNull();
    expect(state.nodes[b2]?.branch_id).toBeNull();
    expect(state.nodes[n3]?.branch_id).toBe(branchId);
  });

  it('selects context nodes with include/exclude', () => {
    const engine = new ContextMapEngine();
    const projectId = engine.createProject('Context Test');
    const n1 = engine.addNode({ projectId, parentId: null, role: 'user', content: 'a', branchId: null });
    const n2 = engine.addNode({ projectId, parentId: n1, role: 'assistant', content: 'b', branchId: null });

    let nodes = engine.selectContextNodes(projectId);
    expect(nodes.map((n) => n.node_id)).toEqual([n1, n2]);

    engine.toggleNodeInclusion(projectId, n1);
    nodes = engine.selectContextNodes(projectId);
    expect(nodes.map((n) => n.node_id)).toEqual([n2]);
  });
});
