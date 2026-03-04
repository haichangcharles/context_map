import type { AddNodeInput, Branch, ContextMapState, ContextView, Node, Project } from './types';
import type { ContextMapEvent, EventBus, StorageAdapter } from './contracts';

export interface ContextMapEngineOptions {
  idGenerator?: () => string;
  now?: () => string;
  initialState?: ContextMapState;
  storage?: StorageAdapter;
  events?: EventBus;
}

type Listener = () => void;

const createInitialState = (): ContextMapState => ({
  projects: {},
  nodes: {},
  branches: {},
  mainlines: {},
  contexts: {},
  patterns: {},
  activeProjectId: null,
});

const deepClone = <T>(value: T): T => {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

export class ContextMapEngine {
  private state: ContextMapState;
  private readonly idGenerator: () => string;
  private readonly now: () => string;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly options: ContextMapEngineOptions = {}) {
    this.idGenerator = options.idGenerator ?? (() => `cm_${Math.random().toString(36).slice(2, 10)}`);
    this.now = options.now ?? (() => new Date().toISOString());
    this.state = options.initialState ? deepClone(options.initialState) : createInitialState();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): ContextMapState {
    return this.state;
  }

  getSnapshot(): ContextMapState {
    return deepClone(this.state);
  }

  async hydrate(): Promise<void> {
    const saved = await this.options.storage?.loadState();
    if (!saved) return;
    this.state = deepClone(saved);
    this.notify();
  }

  async persist(): Promise<void> {
    await this.options.storage?.saveState(this.state);
  }

  createProject(title: string): string {
    const projectId = this.idGenerator();
    const contextId = this.idGenerator();

    const project: Project = {
      project_id: projectId,
      title,
      root_node_id: null,
      mainline_id: `mainline_${projectId}`,
      active_context_id: contextId,
    };

    const context: ContextView = {
      context_id: contextId,
      project_id: projectId,
      base_path: 'mainline',
      included_nodes: [],
      excluded_nodes: [],
      active_pattern: null,
    };

    this.state = {
      ...this.state,
      projects: { ...this.state.projects, [projectId]: project },
      contexts: { ...this.state.contexts, [contextId]: context },
      mainlines: { ...this.state.mainlines, [projectId]: [] },
      activeProjectId: projectId,
    };

    this.emit({ type: 'project.created', projectId, title });
    this.commit();
    return projectId;
  }

  deleteProject(projectId: string): void {
    if (!this.state.projects[projectId]) return;

    const projects = { ...this.state.projects };
    const mainlines = { ...this.state.mainlines };
    delete projects[projectId];
    delete mainlines[projectId];

    const nodes = Object.fromEntries(Object.entries(this.state.nodes).filter(([, n]) => n.project_id !== projectId));
    const branches = Object.fromEntries(Object.entries(this.state.branches).filter(([, b]) => b.project_id !== projectId));
    const contexts = Object.fromEntries(Object.entries(this.state.contexts).filter(([, c]) => c.project_id !== projectId));

    this.state = {
      ...this.state,
      projects,
      mainlines,
      nodes,
      branches,
      contexts,
      activeProjectId: this.state.activeProjectId === projectId ? null : this.state.activeProjectId,
    };

    this.emit({ type: 'project.deleted', projectId });
    this.commit();
  }

  setActiveProject(projectId: string): void {
    if (!this.state.projects[projectId]) return;
    this.state = { ...this.state, activeProjectId: projectId };
    this.emit({ type: 'project.active.changed', projectId });
    this.commit();
  }

  addNode(input: AddNodeInput): string {
    const project = this.state.projects[input.projectId];
    if (!project) throw new Error(`Project not found: ${input.projectId}`);

    const nodeId = this.idGenerator();
    const node: Node = {
      node_id: nodeId,
      project_id: input.projectId,
      parent_id: input.parentId,
      role: input.role,
      content: input.content,
      branch_id: input.branchId,
      timestamp: this.now(),
      metadata: {
        natural_origin_branch_id: input.branchId ?? null,
      },
    };

    const shouldAppendMainline = input.branchId === null;
    const existingMainline = this.state.mainlines[input.projectId] || [];

    this.state = {
      ...this.state,
      nodes: { ...this.state.nodes, [nodeId]: node },
      projects: {
        ...this.state.projects,
        [input.projectId]: {
          ...project,
          root_node_id: project.root_node_id ?? nodeId,
        },
      },
      mainlines: {
        ...this.state.mainlines,
        [input.projectId]: shouldAppendMainline ? [...existingMainline, nodeId] : existingMainline,
      },
    };

    this.emit({ type: 'node.added', projectId: input.projectId, nodeId });
    this.commit();
    return nodeId;
  }

  updateNodeContent(nodeId: string, content: string, mode: 'replace' | 'append' = 'replace'): void {
    const node = this.state.nodes[nodeId];
    if (!node) return;

    this.state = {
      ...this.state,
      nodes: {
        ...this.state.nodes,
        [nodeId]: {
          ...node,
          content: mode === 'append' ? `${node.content}${content}` : content,
        },
      },
    };

    this.emit({ type: 'node.updated', nodeId });
    this.commit();
  }

  createBranch(projectId: string, anchorNodeId: string): string {
    const project = this.state.projects[projectId];
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const context = this.state.contexts[project.active_context_id];
    if (!context) throw new Error(`Context not found for project: ${projectId}`);

    const branchId = this.idGenerator();
    const branch: Branch = {
      branch_id: branchId,
      project_id: projectId,
      anchor_node_id: anchorNodeId,
      status: 'active',
    };

    this.state = {
      ...this.state,
      branches: { ...this.state.branches, [branchId]: branch },
      contexts: {
        ...this.state.contexts,
        [context.context_id]: {
          ...context,
          base_path: branchId,
          included_nodes: [],
          excluded_nodes: [],
        },
      },
    };

    this.emit({ type: 'branch.created', projectId, branchId, anchorNodeId });
    this.commit();
    return branchId;
  }

  promoteBranch(projectId: string, branchId: string): void {
    const project = this.state.projects[projectId];
    const branch = this.state.branches[branchId];
    if (!project || !branch || branch.project_id !== projectId) return;

    const mainline = this.state.mainlines[projectId] || [];
    const branchNodes = Object.values(this.state.nodes)
      .filter((n) => n.branch_id === branchId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const anchorIndex = mainline.indexOf(branch.anchor_node_id);
    if (anchorIndex === -1) return;

    const promotedIds = branchNodes.map((n) => n.node_id);
    const nextMainline = [...mainline.slice(0, anchorIndex + 1), ...promotedIds];
    const nextMainlineSet = new Set(nextMainline);

    const nextNodes: Record<string, Node> = { ...this.state.nodes };
    for (const id of promotedIds) {
      const node = nextNodes[id];
      if (!node) continue;
      nextNodes[id] = { ...node, branch_id: null };
    }

    for (const id of mainline) {
      if (nextMainlineSet.has(id)) continue;
      const node = nextNodes[id];
      if (!node) continue;
      nextNodes[id] = { ...node, branch_id: branchId };
    }

    this.state = {
      ...this.state,
      nodes: nextNodes,
      mainlines: { ...this.state.mainlines, [projectId]: nextMainline },
      branches: {
        ...this.state.branches,
        [branchId]: {
          ...branch,
          status: 'inactive',
        },
      },
    };

    this.emit({ type: 'branch.promoted', projectId, branchId });
    this.returnToMainline(projectId);
  }

  returnToMainline(projectId: string): void {
    const project = this.state.projects[projectId];
    if (!project) return;

    const context = this.state.contexts[project.active_context_id];
    if (!context) return;

    this.state = {
      ...this.state,
      contexts: {
        ...this.state.contexts,
        [context.context_id]: {
          ...context,
          base_path: 'mainline',
          included_nodes: [],
          excluded_nodes: [],
        },
      },
    };

    this.emit({ type: 'context.changed', projectId, contextId: context.context_id });
    this.commit();
  }

  toggleNodeInclusion(projectId: string, nodeId: string): void {
    const project = this.state.projects[projectId];
    if (!project) return;
    const context = this.state.contexts[project.active_context_id];
    if (!context) return;

    const included = new Set(context.included_nodes);
    const excluded = new Set(context.excluded_nodes);

    if (excluded.has(nodeId)) {
      excluded.delete(nodeId);
    } else if (included.has(nodeId)) {
      included.delete(nodeId);
      excluded.add(nodeId);
    } else {
      excluded.add(nodeId);
    }

    this.state = {
      ...this.state,
      contexts: {
        ...this.state.contexts,
        [context.context_id]: {
          ...context,
          included_nodes: [...included],
          excluded_nodes: [...excluded],
        },
      },
    };

    this.commit();
  }

  selectContextNodes(projectId: string): Node[] {
    const project = this.state.projects[projectId];
    if (!project) return [];

    const context = this.state.contexts[project.active_context_id];
    if (!context) return [];

    const visibleMainlineIds = this.state.mainlines[projectId] || [];
    const basePath = context.base_path;
    const ids = new Set<string>();

    if (basePath === 'mainline') {
      for (const id of visibleMainlineIds) ids.add(id);
    } else {
      const activeBranch = this.state.branches[basePath];
      if (activeBranch) {
        const anchorIndex = visibleMainlineIds.indexOf(activeBranch.anchor_node_id);
        const baseNodes = anchorIndex >= 0 ? visibleMainlineIds.slice(0, anchorIndex + 1) : [];
        for (const id of baseNodes) ids.add(id);

        const branchNodes = Object.values(this.state.nodes)
          .filter((n) => n.project_id === projectId && n.branch_id === basePath)
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        for (const node of branchNodes) ids.add(node.node_id);
      }
    }

    for (const id of context.included_nodes) ids.add(id);
    for (const id of context.excluded_nodes) ids.delete(id);

    return [...ids]
      .map((id) => this.state.nodes[id])
      .filter((n): n is Node => !!n)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  private emit(event: ContextMapEvent): void {
    this.options.events?.emit(event);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private commit(): void {
    this.notify();
    void this.persist();
  }
}
