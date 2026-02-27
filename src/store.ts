import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { Project, Node, Branch, ContextView, Pattern, Role } from './types';

type StructureSnapshot = {
  nodes: Record<string, Node>;
  branches: Record<string, Branch>;
  mainlines: Record<string, string[]>;
  contexts: Record<string, ContextView>;
};

interface AppState {
  projects: Record<string, Project>;
  nodes: Record<string, Node>;
  branches: Record<string, Branch>;
  mainlines: Record<string, string[]>; // project_id -> node_ids
  contexts: Record<string, ContextView>;
  patterns: Record<string, Pattern>;
  pastStructureSnapshots: StructureSnapshot[];
  futureStructureSnapshots: StructureSnapshot[];
  naturalMainlines: Record<string, string[]>;
  naturalBranches: Record<string, Branch>;
  
  activeProjectId: string | null;
  
  // Actions
  createProject: (title: string) => string;
  setActiveProject: (projectId: string) => void;
  deleteProject: (projectId: string) => void;
  
  addNode: (projectId: string, parentId: string | null, role: Role, content: string, branchId: string | null) => string;
  updateNodeContent: (nodeId: string, content: string, mode?: 'replace' | 'append') => void;
  createBranch: (projectId: string, anchorNodeId: string) => string;
  promoteBranch: (projectId: string, branchId: string) => void;
  returnToMainline: (projectId: string) => void;
  toggleNodeInclusion: (projectId: string, nodeId: string) => void;
  setActivePattern: (projectId: string, patternId: string | null) => void;
  
  updateBranchSummary: (branchId: string, summary: string) => void;
  createPattern: (projectId: string, name: string, fromNodeId: string, toNodeId: string, guidanceText: string, steps: string[]) => string;
  setActiveStep: (projectId: string, stepIndex: number) => void;
  batchToggleInclusion: (projectId: string, nodeIds: string[], action: 'include' | 'exclude') => void;
  setMainlineEndpoints: (projectId: string, startId: string, endId: string) => void;
  jumpToNode: (projectId: string, nodeId: string) => void;
  undoStructureChange: () => void;
  redoStructureChange: () => void;
  resetStructureToNatural: (projectId: string) => void;
}

const EXAMPLE_PROJECT_ID = 'example-project';
const EXAMPLE_CONTEXT_ID = 'example-context';
const EXAMPLE_BRANCH_RESEARCH = 'example-branch-research';
const EXAMPLE_BRANCH_ARCH = 'example-branch-architecture';
const EXAMPLE_BRANCH_UI = 'example-branch-ui';

const exampleNodes: Record<string, Node> = {
  'ex-n1': {
    node_id: 'ex-n1',
    project_id: EXAMPLE_PROJECT_ID,
    parent_id: null,
    role: 'user',
    content: 'Build a context-map app MVP for multi-threaded AI conversations.',
    branch_id: null,
    timestamp: '2026-02-27T09:00:00.000Z',
    metadata: {},
  },
  'ex-n2': {
    node_id: 'ex-n2',
    project_id: EXAMPLE_PROJECT_ID,
    parent_id: 'ex-n1',
    role: 'assistant',
    content: 'Mainline plan: data model, graph UI, branch promotion, and pattern extraction.',
    branch_id: null,
    timestamp: '2026-02-27T09:01:00.000Z',
    metadata: {},
  },
  'ex-n3': {
    node_id: 'ex-n3',
    project_id: EXAMPLE_PROJECT_ID,
    parent_id: 'ex-n2',
    role: 'user',
    content: 'Start implementing store actions and view context switching.',
    branch_id: null,
    timestamp: '2026-02-27T09:02:00.000Z',
    metadata: {},
  },
  'ex-n4': {
    node_id: 'ex-n4',
    project_id: EXAMPLE_PROJECT_ID,
    parent_id: 'ex-n3',
    role: 'assistant',
    content: 'Store and base path are wired; next is testing mainline endpoint selection.',
    branch_id: null,
    timestamp: '2026-02-27T09:03:00.000Z',
    metadata: {},
  },
  'ex-r1': {
    node_id: 'ex-r1',
    project_id: EXAMPLE_PROJECT_ID,
    parent_id: 'ex-n2',
    role: 'user',
    content: 'Research branch: compare graph libraries and persistence options.',
    branch_id: EXAMPLE_BRANCH_RESEARCH,
    timestamp: '2026-02-27T09:04:00.000Z',
    metadata: {},
  },
  'ex-r2': {
    node_id: 'ex-r2',
    project_id: EXAMPLE_PROJECT_ID,
    parent_id: 'ex-r1',
    role: 'assistant',
    content: 'Recommendation: React Flow + Zustand + SQLite for local-first prototype.',
    branch_id: EXAMPLE_BRANCH_RESEARCH,
    timestamp: '2026-02-27T09:05:00.000Z',
    metadata: {},
  },
  'ex-a1': {
    node_id: 'ex-a1',
    project_id: EXAMPLE_PROJECT_ID,
    parent_id: 'ex-n3',
    role: 'user',
    content: 'Architecture branch: should branches be immutable snapshots?',
    branch_id: EXAMPLE_BRANCH_ARCH,
    timestamp: '2026-02-27T09:06:00.000Z',
    metadata: {},
  },
  'ex-a2': {
    node_id: 'ex-a2',
    project_id: EXAMPLE_PROJECT_ID,
    parent_id: 'ex-a1',
    role: 'assistant',
    content: 'Keep branches mutable in MVP; promote selected branch path into mainline.',
    branch_id: EXAMPLE_BRANCH_ARCH,
    timestamp: '2026-02-27T09:07:00.000Z',
    metadata: {},
  },
  'ex-u1': {
    node_id: 'ex-u1',
    project_id: EXAMPLE_PROJECT_ID,
    parent_id: 'ex-n1',
    role: 'user',
    content: 'UI branch: explore compact graph cards and context-menu actions.',
    branch_id: EXAMPLE_BRANCH_UI,
    timestamp: '2026-02-27T09:08:00.000Z',
    metadata: {},
  },
  'ex-u2': {
    node_id: 'ex-u2',
    project_id: EXAMPLE_PROJECT_ID,
    parent_id: 'ex-u1',
    role: 'assistant',
    content: 'Use right-click for branching, mainline start/end, and locate in chat.',
    branch_id: EXAMPLE_BRANCH_UI,
    timestamp: '2026-02-27T09:09:00.000Z',
    metadata: {},
  },
};

const exampleBranches: Record<string, Branch> = {
  [EXAMPLE_BRANCH_RESEARCH]: {
    branch_id: EXAMPLE_BRANCH_RESEARCH,
    project_id: EXAMPLE_PROJECT_ID,
    anchor_node_id: 'ex-n2',
    status: 'active',
  },
  [EXAMPLE_BRANCH_ARCH]: {
    branch_id: EXAMPLE_BRANCH_ARCH,
    project_id: EXAMPLE_PROJECT_ID,
    anchor_node_id: 'ex-n3',
    status: 'active',
  },
  [EXAMPLE_BRANCH_UI]: {
    branch_id: EXAMPLE_BRANCH_UI,
    project_id: EXAMPLE_PROJECT_ID,
    anchor_node_id: 'ex-n1',
    status: 'active',
  },
};

const MAX_STRUCTURE_HISTORY = 2;

const pickStructure = (state: AppState): StructureSnapshot => ({
  nodes: state.nodes,
  branches: state.branches,
  mainlines: state.mainlines,
  contexts: state.contexts,
});

const withNaturalOriginBranch = (node: Node): Node => {
  if (node.metadata.natural_origin_branch_id !== undefined) return node;
  return {
    ...node,
    metadata: {
      ...node.metadata,
      natural_origin_branch_id: node.branch_id ?? null,
    },
  };
};

export const useAppStore = create<AppState>((set, get) => ({
  projects: {
    [EXAMPLE_PROJECT_ID]: {
      project_id: EXAMPLE_PROJECT_ID,
      title: 'Example Project - Mainline & Branches',
      root_node_id: 'ex-n1',
      mainline_id: `mainline_${EXAMPLE_PROJECT_ID}`,
      active_context_id: EXAMPLE_CONTEXT_ID,
    },
  },
  nodes: exampleNodes,
  branches: exampleBranches,
  mainlines: {
    [EXAMPLE_PROJECT_ID]: ['ex-n1', 'ex-n2', 'ex-n3', 'ex-n4'],
  },
  contexts: {
    [EXAMPLE_CONTEXT_ID]: {
      context_id: EXAMPLE_CONTEXT_ID,
      project_id: EXAMPLE_PROJECT_ID,
      base_path: 'mainline',
      included_nodes: [],
      excluded_nodes: [],
      active_pattern: null,
    },
  },
  patterns: {},
  pastStructureSnapshots: [],
  futureStructureSnapshots: [],
  naturalMainlines: {
    [EXAMPLE_PROJECT_ID]: ['ex-n1', 'ex-n2', 'ex-n3', 'ex-n4'],
  },
  naturalBranches: exampleBranches,
  activeProjectId: EXAMPLE_PROJECT_ID,

  createProject: (title) => {
    const projectId = uuidv4();
    const contextId = uuidv4();
    
    const newProject: Project = {
      project_id: projectId,
      title,
      root_node_id: null,
      mainline_id: `mainline_${projectId}`,
      active_context_id: contextId,
    };

    const newContext: ContextView = {
      context_id: contextId,
      project_id: projectId,
      base_path: 'mainline',
      included_nodes: [],
      excluded_nodes: [],
      active_pattern: null,
    };

    set((state) => ({
      projects: { ...state.projects, [projectId]: newProject },
      mainlines: { ...state.mainlines, [projectId]: [] },
      naturalMainlines: { ...state.naturalMainlines, [projectId]: [] },
      contexts: { ...state.contexts, [contextId]: newContext },
      activeProjectId: projectId,
    }));

    return projectId;
  },

  setActiveProject: (projectId) => {
    set({ activeProjectId: projectId });
  },

  deleteProject: (projectId) => {
    set((state) => {
      const { [projectId]: _, ...restProjects } = state.projects;
      const { [projectId]: __, ...restMainlines } = state.mainlines;
      const { [projectId]: ___, ...restNaturalMainlines } = state.naturalMainlines;
      
      // Clean up nodes, branches, contexts related to this project (simplified for now)
      const newNodes = Object.fromEntries(Object.entries(state.nodes).filter(([_, n]) => n.project_id !== projectId));
      const newBranches = Object.fromEntries(Object.entries(state.branches).filter(([_, b]) => b.project_id !== projectId));
      const newNaturalBranches = Object.fromEntries(Object.entries(state.naturalBranches).filter(([_, b]) => b.project_id !== projectId));
      const newContexts = Object.fromEntries(Object.entries(state.contexts).filter(([_, c]) => c.project_id !== projectId));

      return {
        projects: restProjects,
        mainlines: restMainlines,
        naturalMainlines: restNaturalMainlines,
        nodes: newNodes,
        branches: newBranches,
        naturalBranches: newNaturalBranches,
        contexts: newContexts,
        activeProjectId: state.activeProjectId === projectId ? null : state.activeProjectId,
      };
    });
  },

  addNode: (projectId, parentId, role, content, branchId) => {
    const nodeId = uuidv4();
    const newNode: Node = {
      node_id: nodeId,
      project_id: projectId,
      parent_id: parentId,
      role,
      content,
      branch_id: branchId,
      timestamp: new Date().toISOString(),
      metadata: {
        natural_origin_branch_id: branchId ?? null,
      },
    };

    set((state) => {
      const project = state.projects[projectId];
      const updates: Partial<AppState> = {
        nodes: { ...state.nodes, [nodeId]: newNode },
      };

      if (!project.root_node_id) {
        updates.projects = {
          ...state.projects,
          [projectId]: { ...project, root_node_id: nodeId },
        };
      }

      // If we are on the mainline, append to mainline
      const context = state.contexts[project.active_context_id];
      if (context.base_path === 'mainline') {
        const currentMainline = state.mainlines[projectId] || [];
        updates.mainlines = {
          ...state.mainlines,
          [projectId]: [...currentMainline, nodeId],
        };
        const currentNaturalMainline = state.naturalMainlines[projectId] || [];
        updates.naturalMainlines = {
          ...state.naturalMainlines,
          [projectId]: [...currentNaturalMainline, nodeId],
        };
      }

      return updates;
    });

    return nodeId;
  },

  updateNodeContent: (nodeId, content, mode = 'replace') => {
    set((state) => {
      const node = state.nodes[nodeId];
      if (!node) return state;
      return {
        nodes: {
          ...state.nodes,
          [nodeId]: {
            ...node,
            content: mode === 'append' ? `${node.content}${content}` : content,
          },
        },
      };
    });
  },

  createBranch: (projectId, anchorNodeId) => {
    const branchId = uuidv4();
    const newBranch: Branch = {
      branch_id: branchId,
      project_id: projectId,
      anchor_node_id: anchorNodeId,
      status: 'active',
    };

    set((state) => {
      const project = state.projects[projectId];
      if (!project) return state;
      const context = state.contexts[project.active_context_id];
      if (!context) return state;
      const snapshot = pickStructure(state);
      const pastStructureSnapshots = [...state.pastStructureSnapshots, snapshot].slice(-MAX_STRUCTURE_HISTORY);
      
      const updatedContext: ContextView = {
        ...context,
        base_path: branchId,
        included_nodes: [],
        excluded_nodes: [],
      };

      return {
        pastStructureSnapshots,
        futureStructureSnapshots: [],
        branches: { ...state.branches, [branchId]: newBranch },
        naturalBranches: { ...state.naturalBranches, [branchId]: newBranch },
        contexts: { ...state.contexts, [context.context_id]: updatedContext },
      };
    });

    return branchId;
  },

  promoteBranch: (projectId, branchId) => {
    set((state) => {
      const project = state.projects[projectId];
      if (!project) return state;
      const branch = state.branches[branchId];
      if (!branch || branch.project_id !== projectId) return state;
      const context = state.contexts[project.active_context_id];
      if (!context) return state;
      const snapshot = pickStructure(state);
      const pastStructureSnapshots = [...state.pastStructureSnapshots, snapshot].slice(-MAX_STRUCTURE_HISTORY);
      const currentMainline = state.mainlines[projectId] || [];
      
      // Find the path from anchor to the end of the branch
      const currentNodes = Object.values(state.nodes).filter(n => n.branch_id === branchId);
      // Sort by timestamp to get the sequence (assuming linear branch for simplicity)
      currentNodes.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
      // The new mainline should be: mainline up to anchor + branch nodes
      const anchorIndex = currentMainline.indexOf(branch.anchor_node_id);
      let newMainline = currentMainline;
      if (anchorIndex !== -1) {
        newMainline = [...currentMainline.slice(0, anchorIndex + 1), ...currentNodes.map(n => n.node_id)];
      }
      const newMainlineSet = new Set(newMainline);

      const updatedNodes: Record<string, Node> = { ...state.nodes };
      // Promoted path must become true mainline nodes.
      currentNodes.forEach((node) => {
        const existing = withNaturalOriginBranch(updatedNodes[node.node_id]);
        updatedNodes[node.node_id] = { ...existing, branch_id: null };
      });
      // Old mainline nodes removed by promotion become part of this branch.
      currentMainline.forEach((nodeId) => {
        if (!newMainlineSet.has(nodeId) && updatedNodes[nodeId]) {
          const existing = withNaturalOriginBranch(updatedNodes[nodeId]);
          updatedNodes[nodeId] = { ...existing, branch_id: branchId };
        }
      });

      const updatedContext: ContextView = {
        ...context,
        base_path: 'mainline',
        included_nodes: [],
        excluded_nodes: [],
      };

      return {
        pastStructureSnapshots,
        futureStructureSnapshots: [],
        nodes: updatedNodes,
        mainlines: { ...state.mainlines, [projectId]: newMainline },
        branches: {
          ...state.branches,
          [branchId]: {
            ...branch,
            status: 'inactive',
          },
        },
        contexts: { ...state.contexts, [context.context_id]: updatedContext },
      };
    });
  },

  returnToMainline: (projectId) => {
    set((state) => {
      const project = state.projects[projectId];
      const context = state.contexts[project.active_context_id];
      
      const updatedContext: ContextView = {
        ...context,
        base_path: 'mainline',
      };

      return {
        contexts: { ...state.contexts, [context.context_id]: updatedContext },
      };
    });
  },

  toggleNodeInclusion: (projectId, nodeId) => {
    set((state) => {
      const project = state.projects[projectId];
      const context = state.contexts[project.active_context_id];
      
      let newIncluded = [...context.included_nodes];
      let newExcluded = [...context.excluded_nodes];

      // If it's in excluded, remove from excluded
      if (newExcluded.includes(nodeId)) {
        newExcluded = newExcluded.filter(id => id !== nodeId);
      } else if (newIncluded.includes(nodeId)) {
        // If it's in included, move to excluded
        newIncluded = newIncluded.filter(id => id !== nodeId);
        newExcluded.push(nodeId);
      } else {
        // If it's in neither, it means it's part of the base path or inactive.
        // We can explicitly exclude it.
        newExcluded.push(nodeId);
      }

      return {
        contexts: {
          ...state.contexts,
          [context.context_id]: {
            ...context,
            included_nodes: newIncluded,
            excluded_nodes: newExcluded,
          },
        },
      };
    });
  },

  setActivePattern: (projectId, patternId) => {
    set((state) => {
      const project = state.projects[projectId];
      const context = state.contexts[project.active_context_id];
      
      return {
        contexts: {
          ...state.contexts,
          [context.context_id]: {
            ...context,
            active_pattern: patternId,
            active_step_index: patternId ? 0 : undefined,
          },
        },
      };
    });
  },

  updateBranchSummary: (branchId, summary) => {
    set((state) => {
      const branch = state.branches[branchId];
      if (!branch) return state;
      return {
        branches: {
          ...state.branches,
          [branchId]: { ...branch, mainline_summary: summary },
        },
      };
    });
  },

  createPattern: (projectId, name, fromNodeId, toNodeId, guidanceText, steps) => {
    const patternId = uuidv4();
    const newPattern: Pattern = {
      pattern_id: patternId,
      name,
      source_line: { from: fromNodeId, to: toNodeId },
      guidance_text: guidanceText,
      steps,
    };
    set((state) => ({
      patterns: { ...state.patterns, [patternId]: newPattern },
    }));
    return patternId;
  },

  setActiveStep: (projectId, stepIndex) => {
    set((state) => {
      const project = state.projects[projectId];
      const context = state.contexts[project.active_context_id];
      return {
        contexts: {
          ...state.contexts,
          [context.context_id]: { ...context, active_step_index: stepIndex },
        },
      };
    });
  },

  batchToggleInclusion: (projectId, nodeIds, action) => {
    set((state) => {
      const project = state.projects[projectId];
      const context = state.contexts[project.active_context_id];
      
      let newIncluded = [...context.included_nodes];
      let newExcluded = [...context.excluded_nodes];

      nodeIds.forEach(nodeId => {
        if (action === 'exclude') {
          newIncluded = newIncluded.filter(id => id !== nodeId);
          if (!newExcluded.includes(nodeId)) newExcluded.push(nodeId);
        } else {
          newExcluded = newExcluded.filter(id => id !== nodeId);
          if (!newIncluded.includes(nodeId)) newIncluded.push(nodeId);
        }
      });

      return {
        contexts: {
          ...state.contexts,
          [context.context_id]: {
            ...context,
            included_nodes: newIncluded,
            excluded_nodes: newExcluded,
          },
        },
      };
    });
  },

  setMainlineEndpoints: (projectId, startId, endId) => {
    set((state) => {
      const project = state.projects[projectId];
      if (!project) return state;
      const context = state.contexts[project.active_context_id];
      if (!context) return state;
      const startNode = state.nodes[startId];
      const endNode = state.nodes[endId];
      if (!startNode || !endNode) return state;
      if (startNode.project_id !== projectId || endNode.project_id !== projectId) return state;
      const snapshot = pickStructure(state);
      const pastStructureSnapshots = [...state.pastStructureSnapshots, snapshot].slice(-MAX_STRUCTURE_HISTORY);

      const projectNodes = Object.values(state.nodes).filter((n) => n.project_id === projectId);
      const parentById = new Map<string, string | null>();
      const childrenById = new Map<string, string[]>();

      projectNodes.forEach((node) => {
        parentById.set(node.node_id, node.parent_id);
        if (node.parent_id) {
          if (!childrenById.has(node.parent_id)) {
            childrenById.set(node.parent_id, []);
          }
          childrenById.get(node.parent_id)!.push(node.node_id);
        }
      });

      // Find undirected shortest path start<->end so cross-branch endpoint selection always works.
      const queue: string[] = [startId];
      const visited = new Set<string>([startId]);
      const prev = new Map<string, string | null>([[startId, null]]);

      while (queue.length > 0 && !visited.has(endId)) {
        const current = queue.shift()!;
        const neighbors: string[] = [];
        const parent = parentById.get(current) ?? null;
        if (parent) neighbors.push(parent);
        neighbors.push(...(childrenById.get(current) || []));

        for (const next of neighbors) {
          if (visited.has(next)) continue;
          visited.add(next);
          prev.set(next, current);
          queue.push(next);
        }
      }

      let startToEnd: string[] = [];
      if (visited.has(endId)) {
        const reversePath: string[] = [];
        let curr: string | null = endId;
        while (curr) {
          reversePath.push(curr);
          curr = prev.get(curr) ?? null;
        }
        startToEnd = reversePath.reverse();
      } else {
        // Defensive fallback for unexpected disconnected data.
        startToEnd = startId === endId ? [startId] : [startId, endId];
      }

      // User-selected endpoints are highest priority: mainline is exactly start->end path.
      const newMainline = startToEnd;
      const newMainlineSet = new Set(newMainline);

      const updatedNodes: Record<string, Node> = { ...state.nodes };
      const updatedBranches: Record<string, Branch> = { ...state.branches };

      // Rule 1: nodes on new mainline are always mainline nodes.
      projectNodes.forEach((node) => {
        if (newMainlineSet.has(node.node_id)) {
          const existing = withNaturalOriginBranch(updatedNodes[node.node_id]);
          updatedNodes[node.node_id] = { ...existing, branch_id: null };
        }
      });

      // Rule 2: nodes outside new mainline should be considered branch nodes.
      // For nodes that were previously mainline-only (branch_id === null), place them into auto branches.
      const autoBranchByAnchor = new Map<string, string>();
      projectNodes.forEach((node) => {
        if (newMainlineSet.has(node.node_id)) return;
        if (updatedNodes[node.node_id].branch_id) return;

        let anchor: string | null = node.parent_id;
        while (anchor && !newMainlineSet.has(anchor)) {
          anchor = parentById.get(anchor) ?? null;
        }
        const anchorId = anchor || newMainline[0] || node.node_id;

        let branchId = autoBranchByAnchor.get(anchorId);
        if (!branchId) {
          branchId = uuidv4();
          autoBranchByAnchor.set(anchorId, branchId);
          updatedBranches[branchId] = {
            branch_id: branchId,
            project_id: projectId,
            anchor_node_id: anchorId,
            status: 'active',
          };
        }

        const existing = withNaturalOriginBranch(updatedNodes[node.node_id]);
        updatedNodes[node.node_id] = { ...existing, branch_id: branchId };
      });

      return {
        pastStructureSnapshots,
        futureStructureSnapshots: [],
        nodes: updatedNodes,
        branches: updatedBranches,
        mainlines: { ...state.mainlines, [projectId]: newMainline },
        contexts: {
          ...state.contexts,
          [context.context_id]: {
            ...context,
            base_path: 'mainline',
            included_nodes: [],
            excluded_nodes: [],
          },
        },
      };
    });
  },

  jumpToNode: (projectId, nodeId) => {
    set((state) => {
      const project = state.projects[projectId];
      const node = state.nodes[nodeId];
      if (!project || !node) return state;

      const context = state.contexts[project.active_context_id];
      const basePath = node.branch_id ? node.branch_id : 'mainline';

      return {
        contexts: {
          ...state.contexts,
          [context.context_id]: {
            ...context,
            base_path: basePath,
          },
        },
      };
    });

    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('locate-node', { detail: { nodeId } }));
    }, 100);
  },

  undoStructureChange: () => {
    set((state) => {
      if (state.pastStructureSnapshots.length === 0) return state;

      const previous = state.pastStructureSnapshots[state.pastStructureSnapshots.length - 1];
      const current = pickStructure(state);
      return {
        ...previous,
        pastStructureSnapshots: state.pastStructureSnapshots.slice(0, -1),
        futureStructureSnapshots: [...state.futureStructureSnapshots, current].slice(-MAX_STRUCTURE_HISTORY),
      };
    });
  },

  redoStructureChange: () => {
    set((state) => {
      if (state.futureStructureSnapshots.length === 0) return state;

      const next = state.futureStructureSnapshots[state.futureStructureSnapshots.length - 1];
      const current = pickStructure(state);
      return {
        ...next,
        pastStructureSnapshots: [...state.pastStructureSnapshots, current].slice(-MAX_STRUCTURE_HISTORY),
        futureStructureSnapshots: state.futureStructureSnapshots.slice(0, -1),
      };
    });
  },

  resetStructureToNatural: (projectId) => {
    set((state) => {
      const project = state.projects[projectId];
      if (!project) return state;
      const context = state.contexts[project.active_context_id];
      if (!context) return state;

      const snapshot = pickStructure(state);
      const pastStructureSnapshots = [...state.pastStructureSnapshots, snapshot].slice(-MAX_STRUCTURE_HISTORY);

      const naturalMainline = state.naturalMainlines[projectId] || [];
      const naturalMainlineSet = new Set(naturalMainline);
      const naturalBranchesForProject = Object.fromEntries(
        Object.entries(state.naturalBranches).filter(([, b]) => b.project_id === projectId)
      );

      const updatedNodes: Record<string, Node> = { ...state.nodes };
      Object.values(state.nodes)
        .filter((n) => n.project_id === projectId)
        .forEach((node) => {
          const preserved = withNaturalOriginBranch(node);
          const naturalOriginBranch = preserved.metadata.natural_origin_branch_id ?? null;
          updatedNodes[node.node_id] = {
            ...preserved,
            branch_id: naturalMainlineSet.has(node.node_id) ? null : naturalOriginBranch,
          };
        });

      const updatedBranches: Record<string, Branch> = {
        ...state.branches,
      };
      Object.entries(state.branches).forEach(([id, branch]) => {
        if (branch.project_id === projectId) {
          delete updatedBranches[id];
        }
      });
      Object.entries(naturalBranchesForProject).forEach(([id, branch]) => {
        updatedBranches[id] = { ...branch };
      });

      return {
        pastStructureSnapshots,
        futureStructureSnapshots: [],
        nodes: updatedNodes,
        branches: updatedBranches,
        mainlines: { ...state.mainlines, [projectId]: naturalMainline },
        contexts: {
          ...state.contexts,
          [context.context_id]: {
            ...context,
            base_path: 'mainline',
            included_nodes: [],
            excluded_nodes: [],
          },
        },
      };
    });
  },
}));
