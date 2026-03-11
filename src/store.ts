import { create } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { Project, Node, Branch, ContextView, Pattern, PatternType, Role, DeleteSelectionPreview, SelectionIntent } from './types';
import { logDeletedChatNodes, mergeRecoveredChatState, syncProjectRename, type RecoveredChatState } from './services/chatHistory';
import { logPatternDelete, logPatternUpsert, mergeRemotePatternsIntoPatterns, type PatternSyncRecord } from './services/patternSync';
import { reconcileSelectedNodeIds } from './utils/selectionState';

type StructureSnapshot = {
  projects: Record<string, Project>;
  nodes: Record<string, Node>;
  branches: Record<string, Branch>;
  mainlines: Record<string, string[]>;
  contexts: Record<string, ContextView>;
  naturalMainlines: Record<string, string[]>;
  naturalBranches: Record<string, Branch>;
  deletedNodeIds: string[];
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
  deletedNodeIds: string[];
  isNodeSelectionMode: boolean;
  nodeSelectionIntent: SelectionIntent;
  selectedNodeIds: string[];
  
  activeProjectId: string | null;
  
  // Actions
  createProject: (title: string) => string;
  setActiveProject: (projectId: string) => void;
  renameProject: (projectId: string, newTitle: string) => void;
  deleteProject: (projectId: string) => void;
  
  addNode: (projectId: string, parentId: string | null, role: Role, content: string, branchId: string | null) => string;
  updateNodeContent: (nodeId: string, content: string, mode?: 'replace' | 'append') => void;
  createBranch: (projectId: string, anchorNodeId: string) => string;
  acceptSuggestedBranch: (projectId: string, anchorNodeId: string, nodeIdsToMove: string[]) => string | null;
  promoteBranch: (projectId: string, branchId: string) => void;
  returnToMainline: (projectId: string) => void;
  returnToParentBranch: (projectId: string) => void;
  cycleNodeInclusionState: (projectId: string, nodeId: string) => void;
  toggleNodeInclusion: (projectId: string, nodeId: string) => void;
  enablePatternForType: (projectId: string, contextId: string, type: PatternType, patternId: string) => void;
  disablePatternForType: (projectId: string, contextId: string, type: PatternType) => void;
  
  updateBranchSummary: (branchId: string, summary: string) => void;
  createPattern: (input: {
    type: PatternType;
    name: string;
    requires_human_review: boolean;
    instruction: string;
    example: string;
    fromNodeId: string;
    toNodeId: string;
    sourceProjectId?: string;
  }) => string;
  updatePattern: (
    patternId: string,
    patch: Partial<Pick<Pattern, 'name' | 'instruction' | 'example' | 'requires_human_review'>>
  ) => void;
  approvePattern: (patternId: string) => void;
  deletePattern: (patternId: string) => void;
  batchToggleInclusion: (projectId: string, nodeIds: string[], action: 'include' | 'exclude') => void;
  setMainlineEndpoints: (projectId: string, startId: string, endId: string) => void;
  previewDeleteSelectedNodes: (projectId: string, nodeIds: string[]) => DeleteSelectionPreview | null;
  deleteSelectedNodes: (projectId: string, nodeIds: string[]) => DeleteSelectionPreview | null;
  jumpToNode: (projectId: string, nodeId: string) => void;
  undoStructureChange: () => void;
  redoStructureChange: () => void;
  resetStructureToNatural: (projectId: string) => void;
  startNodeSelectionMode: (intent: SelectionIntent) => void;
  finishNodeSelectionMode: () => void;
  clearNodeSelection: () => void;
  toggleNodeSelection: (nodeId: string) => void;
  applyNodeSelectionChanges: (changes: Array<{ id: string; selected: boolean }>) => void;
}

const EXAMPLE_PROJECT_ID = 'example-project';
const EXAMPLE_CONTEXT_ID = 'example-context';
const EXAMPLE_BRANCH_RESEARCH = 'example-branch-research';
const EXAMPLE_BRANCH_ARCH = 'example-branch-architecture';
const EXAMPLE_BRANCH_UI = 'example-branch-ui';

const shouldSeedExampleData = (): boolean => {
  if (typeof window === 'undefined') return false;
  const activeUserKey = 'context-map.active-user-id';
  const fallbackUser = 'local-anonymous';
  const storeKey = 'context-map.app-state.v1';
  const userId = (window.localStorage.getItem(activeUserKey) || '').trim() || fallbackUser;
  const scopedStoreKey = `${storeKey}:${userId}`;
  const hasPersistedState = !!window.localStorage.getItem(scopedStoreKey);
  return userId === 'test' || !hasPersistedState;
};

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
    parent_branch_id: null,
    status: 'active',
  },
  [EXAMPLE_BRANCH_ARCH]: {
    branch_id: EXAMPLE_BRANCH_ARCH,
    project_id: EXAMPLE_PROJECT_ID,
    anchor_node_id: 'ex-n3',
    parent_branch_id: null,
    status: 'active',
  },
  [EXAMPLE_BRANCH_UI]: {
    branch_id: EXAMPLE_BRANCH_UI,
    project_id: EXAMPLE_PROJECT_ID,
    anchor_node_id: 'ex-n1',
    parent_branch_id: null,
    status: 'active',
  },
};

const MAX_STRUCTURE_HISTORY = 2;
const STORE_PERSIST_KEY = 'context-map.app-state.v1';
const ACTIVE_USER_KEY = 'context-map.active-user-id';
const FALLBACK_USER_KEY = 'local-anonymous';

const resolveUserScopedStoreKey = (baseKey: string): string => {
  if (typeof window === 'undefined') return `${baseKey}:${FALLBACK_USER_KEY}`;
  try {
    const raw = (window.localStorage.getItem(ACTIVE_USER_KEY) || '').trim();
    const user = raw || FALLBACK_USER_KEY;
    return `${baseKey}:${user}`;
  } catch {
    return `${baseKey}:${FALLBACK_USER_KEY}`;
  }
};

const userScopedStorage: StateStorage = {
  getItem: (name) => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(resolveUserScopedStoreKey(name));
  },
  setItem: (name, value) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(resolveUserScopedStoreKey(name), value);
  },
  removeItem: (name) => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(resolveUserScopedStoreKey(name));
  },
};

const pickStructure = (state: AppState): StructureSnapshot => ({
  projects: state.projects,
  nodes: state.nodes,
  branches: state.branches,
  mainlines: state.mainlines,
  contexts: state.contexts,
  naturalMainlines: state.naturalMainlines,
  naturalBranches: state.naturalBranches,
  deletedNodeIds: state.deletedNodeIds,
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

const compactText = (text: string, max = 140): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, max);

const deriveTailSummary = (nodes: Node[]): string => {
  if (nodes.length === 0) return '';
  const tail = nodes.slice(-2).map((n) => compactText(n.content, 80)).filter(Boolean);
  return tail.join(' | ');
};

const deriveBranchMetadata = (
  state: AppState,
  projectId: string,
  context: ContextView,
  anchorNodeId: string,
  movedNodeIds: string[] = []
): { intentSummary: string; parentContextTLDR: string } => {
  const anchorNode = state.nodes[anchorNodeId];
  const movedNodes = movedNodeIds
    .map((id) => state.nodes[id])
    .filter((n): n is Node => !!n && n.project_id === projectId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const intentSource =
    movedNodes.find((n) => n.role === 'user')?.content ||
    movedNodes[0]?.content ||
    anchorNode?.content ||
    'Follow-up subtask';

  if (context.base_path === 'mainline') {
    const mainlineIds = state.mainlines[projectId] || [];
    const mainlineNodes = mainlineIds.map((id) => state.nodes[id]).filter((n): n is Node => !!n);
    const mainlineTail = deriveTailSummary(mainlineNodes);
    return {
      intentSummary: compactText(intentSource, 120),
      parentContextTLDR: mainlineTail ? `Mainline TLDR: ${mainlineTail}` : 'Mainline TLDR: continuing primary objective.',
    };
  }

  const parentBranch = state.branches[context.base_path];
  const parentHint =
    parentBranch?.intent_summary ||
    parentBranch?.mainline_summary ||
    (parentBranch?.anchor_node_id ? state.nodes[parentBranch.anchor_node_id]?.content : '') ||
    '';

  return {
    intentSummary: compactText(intentSource, 120),
    parentContextTLDR: parentHint
      ? `Parent branch TLDR: ${compactText(parentHint, 140)}`
      : 'Parent branch TLDR: continue current branch objective.',
  };
};

const deriveParentBranchIdFromAnchor = (
  state: AppState,
  projectId: string,
  anchorNodeId: string
): string | null => {
  const anchorNode = state.nodes[anchorNodeId];
  if (!anchorNode || anchorNode.project_id !== projectId) return null;
  if (!anchorNode.branch_id) return null;
  const anchorBranch = state.branches[anchorNode.branch_id];
  if (!anchorBranch || anchorBranch.project_id !== projectId) return null;
  return anchorBranch.branch_id;
};

const getBranchChainIds = (branchId: string, branches: Record<string, Branch>): string[] => {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = branchId;

  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const branch = branches[cursor];
    if (!branch) break;
    chain.push(branch.branch_id);
    cursor = branch.parent_branch_id;
  }

  return chain.reverse();
};

const resolveVisibleNodeIdsForBasePath = (
  projectId: string,
  basePath: string,
  branchesById: Record<string, Branch>,
  nodesById: Record<string, Node>,
  mainlineIds: string[]
): Set<string> => {
  const validMainlineIds = mainlineIds.filter((id) => nodesById[id]?.project_id === projectId);

  if (basePath === 'mainline') {
    return new Set(validMainlineIds);
  }

  const currentBranch = branchesById[basePath];
  if (!currentBranch) {
    return new Set(validMainlineIds);
  }

  const branchChainIds = getBranchChainIds(currentBranch.branch_id, branchesById);
  const rootBranchId = branchChainIds[0];
  const rootBranch = rootBranchId ? branchesById[rootBranchId] : null;
  const anchorIndex = rootBranch ? validMainlineIds.indexOf(rootBranch.anchor_node_id) : -1;
  const baseNodeIds = anchorIndex !== -1 ? validMainlineIds.slice(0, anchorIndex + 1) : validMainlineIds;
  const visibleIds = new Set<string>(baseNodeIds);
  const allProjectNodes = Object.values(nodesById).filter((node) => node.project_id === projectId);

  branchChainIds.forEach((branchId, idx) => {
    const segmentNodes = allProjectNodes
      .filter((node) => node.branch_id === branchId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const nextBranchId = branchChainIds[idx + 1];
    if (!nextBranchId) {
      segmentNodes.forEach((node) => visibleIds.add(node.node_id));
      return;
    }

    const nextAnchorNodeId = branchesById[nextBranchId]?.anchor_node_id;
    const cutoffIndex = nextAnchorNodeId
      ? segmentNodes.findIndex((node) => node.node_id === nextAnchorNodeId)
      : -1;
    const nodesToInclude = cutoffIndex === -1 ? segmentNodes : segmentNodes.slice(0, cutoffIndex + 1);
    nodesToInclude.forEach((node) => visibleIds.add(node.node_id));
  });

  return visibleIds;
};

const ensureNonEmptyMainline = (
  projectId: string,
  candidateMainline: string[],
  nodesById: Record<string, Node>,
  preferredNodeIds: string[]
): { mainline: string[]; repairedNodeId: string | null } => {
  if (candidateMainline.length > 0) {
    return { mainline: candidateMainline, repairedNodeId: null };
  }

  const sortedProjectNodeIds = Object.values(nodesById)
    .filter((n) => n.project_id === projectId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((n) => n.node_id);
  const fallbackNodeId =
    [...preferredNodeIds, ...sortedProjectNodeIds].find((id) => !!id && nodesById[id]?.project_id === projectId) || null;

  if (!fallbackNodeId) {
    return { mainline: candidateMainline, repairedNodeId: null };
  }

  return { mainline: [fallbackNodeId], repairedNodeId: fallbackNodeId };
};

type DeleteStructureResult = {
  projects: Record<string, Project>;
  nodes: Record<string, Node>;
  branches: Record<string, Branch>;
  mainlines: Record<string, string[]>;
  contexts: Record<string, ContextView>;
  naturalMainlines: Record<string, string[]>;
  naturalBranches: Record<string, Branch>;
  preview: DeleteSelectionPreview;
};

type DeletePlannerState = Pick<
  AppState,
  'projects' | 'nodes' | 'branches' | 'mainlines' | 'contexts' | 'naturalMainlines' | 'naturalBranches' | 'activeProjectId' | 'deletedNodeIds'
>;

const filterRecoveredChatStateByDeletedNodeIds = (
  recoveredState: RecoveredChatState,
  deletedNodeIds: string[]
): RecoveredChatState => {
  if (deletedNodeIds.length === 0) return recoveredState;

  const deletedSet = new Set(deletedNodeIds);
  const nodes = Object.fromEntries(
    Object.entries(recoveredState.nodes).filter(([nodeId]) => !deletedSet.has(nodeId))
  ) as Record<string, Node>;

  const branches = Object.fromEntries(
    Object.entries(recoveredState.branches).filter(([, branch]) => {
      if (deletedSet.has(branch.anchor_node_id)) return false;
      return Object.values(nodes).some((node) => node.branch_id === branch.branch_id);
    })
  ) as Record<string, Branch>;

  const naturalBranches = Object.fromEntries(
    Object.entries(recoveredState.naturalBranches).filter(([, branch]) => {
      if (deletedSet.has(branch.anchor_node_id)) return false;
      return Object.values(nodes).some((node) => node.branch_id === branch.branch_id);
    })
  ) as Record<string, Branch>;

  const mainlines = Object.fromEntries(
    Object.entries(recoveredState.mainlines).map(([projectId, ids]) => [
      projectId,
      ids.filter((nodeId) => !deletedSet.has(nodeId) && !!nodes[nodeId]),
    ])
  ) as Record<string, string[]>;

  const naturalMainlines = Object.fromEntries(
    Object.entries(recoveredState.naturalMainlines).map(([projectId, ids]) => [
      projectId,
      ids.filter((nodeId) => !deletedSet.has(nodeId) && !!nodes[nodeId]),
    ])
  ) as Record<string, string[]>;

  const survivingProjectIds = new Set(
    Object.values(nodes)
      .map((node) => node.project_id)
      .filter(Boolean)
  );

  const projects = Object.fromEntries(
    Object.entries(recoveredState.projects).flatMap(([projectId, project]) => {
      if (!survivingProjectIds.has(projectId)) return [];
      const nextRootNodeId =
        (!project.root_node_id || deletedSet.has(project.root_node_id) ? null : project.root_node_id) ||
        mainlines[projectId]?.[0] ||
        Object.values(nodes).find((node) => node.project_id === projectId)?.node_id ||
        null;
      return [[
        projectId,
        {
          ...project,
          root_node_id: nextRootNodeId,
        },
      ]];
    })
  ) as Record<string, Project>;

  const contexts = Object.fromEntries(
    Object.entries(recoveredState.contexts).flatMap(([contextId, context]) => {
      if (!survivingProjectIds.has(context.project_id)) return [];
      return [[
        contextId,
        {
          ...context,
          base_path: context.base_path === 'mainline' || branches[context.base_path] ? context.base_path : 'mainline',
          included_nodes: context.included_nodes.filter((nodeId) => !!nodes[nodeId]),
          excluded_nodes: context.excluded_nodes.filter((nodeId) => !!nodes[nodeId]),
        },
      ]];
    })
  ) as Record<string, ContextView>;

  return {
    ...recoveredState,
    projects,
    nodes,
    branches,
    mainlines,
    contexts,
    naturalMainlines,
    naturalBranches,
  };
};

const DELETE_PLACEHOLDER_CONTENT = '[Deleted messages]';

const buildPreviewNode = (
  id: string,
  label: string,
  role: Role,
  variant: 'normal' | 'selected' | 'placeholder'
) => ({ id, label, role, variant });

const buildPreviewNodeVariants = (
  previewNodes: Array<{ id: string; variant: 'normal' | 'selected' | 'placeholder' }>
) => Object.fromEntries(previewNodes.map((node) => [node.id, node.variant])) as Record<string, 'normal' | 'selected' | 'placeholder'>;

const buildPreviewEdgeList = (previewNodes: { id: string }[], nodesById: Record<string, Node>) =>
  previewNodes.flatMap((node) => {
    const current = nodesById[node.id];
    if (!current?.parent_id) return [];
    if (!previewNodes.some((candidate) => candidate.id === current.parent_id)) return [];
    return [{ source: current.parent_id, target: current.node_id }];
  });

const deriveDeleteSelectionStructure = (
  state: DeletePlannerState,
  projectId: string,
  rawNodeIds: string[]
): DeleteStructureResult | null => {
  const project = state.projects[projectId];
  if (!project) return null;

  const selectedNodeIds = Array.from(new Set(rawNodeIds)).filter((nodeId) => state.nodes[nodeId]?.project_id === projectId);
  if (selectedNodeIds.length === 0) return null;

  const selectedSet = new Set(selectedNodeIds);
  const projectNodes = Object.values(state.nodes)
    .filter((node) => node.project_id === projectId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const projectNodeSet = new Set(projectNodes.map((node) => node.node_id));
  const childrenByParent = new Map<string, Node[]>();

  projectNodes.forEach((node) => {
    if (!node.parent_id || !projectNodeSet.has(node.parent_id)) return;
    if (!childrenByParent.has(node.parent_id)) {
      childrenByParent.set(node.parent_id, []);
    }
    childrenByParent.get(node.parent_id)!.push(node);
  });

  const selectedRoots = projectNodes.filter((node) => selectedSet.has(node.node_id) && (!node.parent_id || !selectedSet.has(node.parent_id)));
  const componentBySelectedNode = new Map<string, string>();
  const componentFrontierParent = new Map<string, string | null>();
  const componentFrontierChildren = new Map<string, Set<string>>();
  const componentPlaceholderIds = new Map<string, string>();
  const placeholderIds: string[] = [];
  const childParentOverrides = new Map<string, string | null>();
  const nodesToKeep = new Map<string, Node>();

  projectNodes.forEach((node) => {
    if (!selectedSet.has(node.node_id)) {
      nodesToKeep.set(node.node_id, node);
    }
  });

  selectedRoots.forEach((root) => {
    const componentId = root.node_id;
    const stack = [root.node_id];
    const componentSelectedIds = new Set<string>();

    while (stack.length > 0) {
      const currentId = stack.pop()!;
      if (componentSelectedIds.has(currentId)) continue;
      componentSelectedIds.add(currentId);
      componentBySelectedNode.set(currentId, componentId);
      (childrenByParent.get(currentId) || []).forEach((child) => {
        if (selectedSet.has(child.node_id)) {
          stack.push(child.node_id);
        }
      });
    }

    const frontierChildren = new Set<string>();
    componentSelectedIds.forEach((selectedId) => {
      (childrenByParent.get(selectedId) || []).forEach((child) => {
        if (!selectedSet.has(child.node_id)) {
          frontierChildren.add(child.node_id);
        }
      });
    });

    const hasSurvivingAnchoredBranch = Object.values(state.branches).some((branch) => {
      if (branch.project_id !== projectId) return false;
      if (!componentSelectedIds.has(branch.anchor_node_id)) return false;
      return projectNodes.some((node) => node.branch_id === branch.branch_id && !selectedSet.has(node.node_id));
    });

    const needsPlaceholder = frontierChildren.size > 1 || hasSurvivingAnchoredBranch;
    componentFrontierChildren.set(componentId, frontierChildren);

    const rootParentId = root.parent_id && !selectedSet.has(root.parent_id) ? root.parent_id : null;
    componentFrontierParent.set(componentId, rootParentId);

    if (!needsPlaceholder) return;

    const placeholderId = `placeholder-${uuidv4()}`;
    const placeholderNode: Node = {
      node_id: placeholderId,
      project_id: projectId,
      parent_id: rootParentId,
      role: 'system',
      content: DELETE_PLACEHOLDER_CONTENT,
      branch_id: root.branch_id ?? null,
      timestamp: root.timestamp,
      metadata: {
        natural_origin_branch_id: root.branch_id ?? null,
        is_delete_placeholder: true,
      },
    };
    componentPlaceholderIds.set(componentId, placeholderId);
    placeholderIds.push(placeholderId);
    nodesToKeep.set(placeholderId, placeholderNode);
  });

  componentFrontierChildren.forEach((frontierChildren, componentId) => {
    const placeholderId = componentPlaceholderIds.get(componentId);
    const nextParentId = placeholderId ?? componentFrontierParent.get(componentId) ?? null;
    frontierChildren.forEach((childId) => {
      childParentOverrides.set(childId, nextParentId);
    });
  });

  const nextNodes = Object.fromEntries(
    Array.from(nodesToKeep.values()).map((node) => {
      const overriddenParentId = childParentOverrides.has(node.node_id)
        ? childParentOverrides.get(node.node_id) ?? null
        : node.parent_id;
      return [
        node.node_id,
        {
          ...node,
          parent_id: overriddenParentId,
        },
      ];
    })
  ) as Record<string, Node>;

  const applyBranchDeletePlan = (sourceBranches: Record<string, Branch>) => {
    const nextBranches: Record<string, Branch> = {};

    Object.values(sourceBranches).forEach((branch) => {
      if (branch.project_id !== projectId) {
        nextBranches[branch.branch_id] = branch;
        return;
      }

      const survivingBranchNodes = Object.values(nextNodes).filter((node) => node.project_id === projectId && node.branch_id === branch.branch_id);
      if (survivingBranchNodes.length === 0) {
        return;
      }

      const placeholderAnchorId = componentPlaceholderIds.get(componentBySelectedNode.get(branch.anchor_node_id) || '');
      const nextAnchorId = placeholderAnchorId || branch.anchor_node_id;
      if (!nextNodes[nextAnchorId]) {
        return;
      }

      nextBranches[branch.branch_id] = {
        ...branch,
        anchor_node_id: nextAnchorId,
      };
    });

    return nextBranches;
  };

  const nextBranches = applyBranchDeletePlan(state.branches);
  const nextNaturalBranches = applyBranchDeletePlan(state.naturalBranches);

  const replaceMainlineSelection = (sourceMainlines: Record<string, string[]>) => {
    const currentMainline = sourceMainlines[projectId] || [];
    const handledComponents = new Set<string>();
    let nextMainline = currentMainline.flatMap((nodeId) => {
      if (!selectedSet.has(nodeId)) return [nodeId];
      const componentId = componentBySelectedNode.get(nodeId);
      if (!componentId || handledComponents.has(componentId)) return [];
      handledComponents.add(componentId);
      const placeholderId = componentPlaceholderIds.get(componentId);
      return placeholderId && nextNodes[placeholderId]?.branch_id === null ? [placeholderId] : [];
    });

    nextMainline = nextMainline.filter((nodeId) => !!nextNodes[nodeId] && nextNodes[nodeId].project_id === projectId);
    const repaired = ensureNonEmptyMainline(projectId, nextMainline, nextNodes, [
      ...placeholderIds,
      ...Object.keys(nextNodes),
    ]);
    if (repaired.repairedNodeId && nextNodes[repaired.repairedNodeId]) {
      nextNodes[repaired.repairedNodeId] = {
        ...nextNodes[repaired.repairedNodeId],
        branch_id: null,
      };
    }
    return {
      ...sourceMainlines,
      [projectId]: repaired.mainline,
    };
  };

  const nextMainlines = replaceMainlineSelection(state.mainlines);
  const nextNaturalMainlines = replaceMainlineSelection(state.naturalMainlines);

  const nextContexts = Object.fromEntries(
    Object.values(state.contexts).map((context) => {
      if (context.project_id !== projectId) {
        return [context.context_id, context];
      }

      const nextBasePath =
        context.base_path === 'mainline' || nextBranches[context.base_path]
          ? context.base_path
          : 'mainline';

      return [
        context.context_id,
        {
          ...context,
          base_path: nextBasePath,
          included_nodes: context.included_nodes.filter((nodeId) => !!nextNodes[nodeId]),
          excluded_nodes: context.excluded_nodes.filter((nodeId) => !!nextNodes[nodeId]),
        },
      ];
    })
  ) as Record<string, ContextView>;

  const nextProjects = { ...state.projects };
  const remainingProjectNodes = Object.values(nextNodes)
    .filter((node) => node.project_id === projectId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const nextRootNodeId = (nextMainlines[projectId] || [])[0] || remainingProjectNodes[0]?.node_id || null;
  nextProjects[projectId] = {
    ...project,
    root_node_id: nextRootNodeId,
  };

  const impactedBeforeIds = new Set<string>();
  selectedNodeIds.forEach((nodeId) => impactedBeforeIds.add(nodeId));
  selectedRoots.forEach((root) => {
    if (root.parent_id && state.nodes[root.parent_id]?.project_id === projectId) {
      impactedBeforeIds.add(root.parent_id);
    }
    const frontierChildren = componentFrontierChildren.get(root.node_id) || new Set<string>();
    frontierChildren.forEach((childId) => impactedBeforeIds.add(childId));
  });

  const beforePreviewNodes = Array.from(impactedBeforeIds)
    .map((nodeId) => state.nodes[nodeId])
    .filter((node): node is Node => !!node)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((node) =>
      buildPreviewNode(
        node.node_id,
        compactText(node.content, 32) || node.node_id,
        node.role,
        selectedSet.has(node.node_id) ? 'selected' : node.metadata.is_delete_placeholder ? 'placeholder' : 'normal'
      )
    );

  const impactedAfterIds = new Set<string>();
  beforePreviewNodes.forEach((node) => {
    if (!selectedSet.has(node.id) && nextNodes[node.id]) {
      impactedAfterIds.add(node.id);
    }
  });
  placeholderIds.forEach((nodeId) => impactedAfterIds.add(nodeId));
  childParentOverrides.forEach((parentId, childId) => {
    impactedAfterIds.add(childId);
    if (parentId) impactedAfterIds.add(parentId);
  });

  const afterPreviewNodes = Array.from(impactedAfterIds)
    .map((nodeId) => nextNodes[nodeId])
    .filter((node): node is Node => !!node)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((node) =>
      buildPreviewNode(
        node.node_id,
        compactText(node.content, 32) || node.node_id,
        node.role,
        node.metadata.is_delete_placeholder ? 'placeholder' : 'normal'
      )
    );

  const previewNodeVariants = buildPreviewNodeVariants([
    ...beforePreviewNodes,
    ...afterPreviewNodes,
  ]);

  const preview: DeleteSelectionPreview = {
    deletedNodeIds: selectedNodeIds,
    placeholderNodeIds: placeholderIds,
    requiresPlaceholder: placeholderIds.length > 0,
    summary:
      placeholderIds.length > 0
        ? `Delete ${selectedNodeIds.length} node(s) and insert ${placeholderIds.length} placeholder node(s) to preserve remaining branches.`
        : `Delete ${selectedNodeIds.length} node(s) and reconnect the remaining thread.`,
    nodeVariants: previewNodeVariants,
    candidate: {
      projects: nextProjects,
      nodes: nextNodes,
      branches: nextBranches,
      mainlines: nextMainlines,
      contexts: nextContexts,
    },
    before: {
      nodes: beforePreviewNodes,
      edges: buildPreviewEdgeList(beforePreviewNodes, state.nodes),
    },
    after: {
      nodes: afterPreviewNodes,
      edges: buildPreviewEdgeList(afterPreviewNodes, nextNodes),
    },
  };

  return {
    projects: nextProjects,
    nodes: nextNodes,
    branches: nextBranches,
    mainlines: nextMainlines,
    contexts: nextContexts,
    naturalMainlines: nextNaturalMainlines,
    naturalBranches: nextNaturalBranches,
    preview,
  };
};

export const previewDeleteSelectedNodes = (
  state: DeletePlannerState,
  projectId: string,
  nodeIds: string[]
): DeleteSelectionPreview | null => deriveDeleteSelectionStructure(state, projectId, nodeIds)?.preview ?? null;

export const useAppStore = create<AppState>()(persist((set, get) => {
  const seedExampleData = shouldSeedExampleData();

  return {
  projects: seedExampleData
    ? {
        [EXAMPLE_PROJECT_ID]: {
          project_id: EXAMPLE_PROJECT_ID,
          title: 'Example Project - Mainline & Branches',
          root_node_id: 'ex-n1',
          mainline_id: `mainline_${EXAMPLE_PROJECT_ID}`,
          active_context_id: EXAMPLE_CONTEXT_ID,
        },
      }
    : {},
  nodes: seedExampleData ? exampleNodes : {},
  branches: seedExampleData ? exampleBranches : {},
  mainlines: seedExampleData
    ? {
        [EXAMPLE_PROJECT_ID]: ['ex-n1', 'ex-n2', 'ex-n3', 'ex-n4'],
      }
    : {},
  contexts: seedExampleData
    ? {
        [EXAMPLE_CONTEXT_ID]: {
          context_id: EXAMPLE_CONTEXT_ID,
          project_id: EXAMPLE_PROJECT_ID,
          base_path: 'mainline',
          included_nodes: [],
          excluded_nodes: [],
          enabled_patterns_by_type: {},
        },
      }
    : {},
  patterns: {},
  pastStructureSnapshots: [],
  futureStructureSnapshots: [],
  naturalMainlines: seedExampleData
    ? {
        [EXAMPLE_PROJECT_ID]: ['ex-n1', 'ex-n2', 'ex-n3', 'ex-n4'],
      }
    : {},
  naturalBranches: seedExampleData ? exampleBranches : {},
  deletedNodeIds: [],
  isNodeSelectionMode: false,
  nodeSelectionIntent: 'batch',
  selectedNodeIds: [],
  activeProjectId: seedExampleData ? EXAMPLE_PROJECT_ID : null,

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
      enabled_patterns_by_type: {},
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

  renameProject: (projectId, newTitle) => {
    const project = get().projects[projectId];
    if (!project) return;
    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: { ...project, title: newTitle },
      },
    }));
    void syncProjectRename(projectId, newTitle).catch(() => {});
  },

  deleteProject: (projectId) => {
    const stateBeforeDelete = get();
    const deletedNodes = Object.values(stateBeforeDelete.nodes).filter((node) => node.project_id === projectId);
    const deletedNodeIds = deletedNodes.map((node) => node.node_id);
    const projectTitle = stateBeforeDelete.projects[projectId]?.title ?? null;

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
        deletedNodeIds: Array.from(new Set([...state.deletedNodeIds, ...deletedNodeIds])),
        selectedNodeIds: state.selectedNodeIds.filter((nodeId) => newNodes[nodeId]),
        activeProjectId: state.activeProjectId === projectId ? null : state.activeProjectId,
      };
    });

    void logDeletedChatNodes(deletedNodes, { projectTitle });
  },

  addNode: (projectId, parentId, role, content, branchId) => {
    const nodeId = uuidv4();

    set((state) => {
      const project = state.projects[projectId];
      if (!project) return state;
      const context = state.contexts[project.active_context_id];
      if (!context) return state;
      const currentMainline = state.mainlines[projectId] || [];
      const mainlineTailId = currentMainline.length > 0 ? currentMainline[currentMainline.length - 1] : null;

      const resolvedParentId =
        context.base_path === 'mainline' && branchId === null
          ? mainlineTailId ?? parentId
          : parentId;

      const newNode: Node = {
        node_id: nodeId,
        project_id: projectId,
        parent_id: resolvedParentId,
        role,
        content,
        branch_id: branchId,
        timestamp: new Date().toISOString(),
        metadata: {
          natural_origin_branch_id: branchId ?? null,
        },
      };

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
      if (context.base_path === 'mainline') {
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

    set((state) => {
      const project = state.projects[projectId];
      if (!project) return state;
      const context = state.contexts[project.active_context_id];
      if (!context) return state;
      const parentBranchId = deriveParentBranchIdFromAnchor(state, projectId, anchorNodeId);
      const { intentSummary, parentContextTLDR } = deriveBranchMetadata(state, projectId, context, anchorNodeId);
      const newBranch: Branch = {
        branch_id: branchId,
        project_id: projectId,
        anchor_node_id: anchorNodeId,
        parent_branch_id: parentBranchId,
        status: 'active',
        intent_summary: intentSummary,
        parent_context_tldr: parentContextTLDR,
      };
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

  acceptSuggestedBranch: (projectId, anchorNodeId, nodeIdsToMove) => {
    if (!nodeIdsToMove.length) return null;

    const branchId = uuidv4();

    let movedCount = 0;
    let rejectedBecauseStale = false;

    set((state) => {
      const project = state.projects[projectId];
      if (!project) return state;
      const context = state.contexts[project.active_context_id];
      if (!context) return state;
      const expectedBranchId = context.base_path === 'mainline' ? null : context.base_path;
      const dedupedMoveIds = Array.from(new Set(nodeIdsToMove));
      const validatedMoveIds = dedupedMoveIds.filter((nodeId, index) => {
        const node = state.nodes[nodeId];
        if (!node || node.project_id !== projectId) return false;
        if (node.branch_id !== expectedBranchId) return false;
        if (index === 0) {
          return node.parent_id === anchorNodeId;
        }
        const prevId = dedupedMoveIds[index - 1];
        return node.parent_id === prevId;
      });
      if (validatedMoveIds.length !== dedupedMoveIds.length || validatedMoveIds.length === 0) {
        rejectedBecauseStale = true;
        return state;
      }
      const parentBranchId = deriveParentBranchIdFromAnchor(state, projectId, anchorNodeId);
      const { intentSummary, parentContextTLDR } = deriveBranchMetadata(
        state,
        projectId,
        context,
        anchorNodeId,
        validatedMoveIds
      );
      const newBranch: Branch = {
        branch_id: branchId,
        project_id: projectId,
        anchor_node_id: anchorNodeId,
        parent_branch_id: parentBranchId,
        status: 'active',
        intent_summary: intentSummary,
        parent_context_tldr: parentContextTLDR,
      };
      const snapshot = pickStructure(state);
      const pastStructureSnapshots = [...state.pastStructureSnapshots, snapshot].slice(-MAX_STRUCTURE_HISTORY);

      const updatedNodes: Record<string, Node> = { ...state.nodes };
      const removalSet = new Set<string>();
      const expectedFirstMovedNodeId = validatedMoveIds[0] || null;

      validatedMoveIds.forEach((nodeId) => {
        const node = updatedNodes[nodeId];
        if (!node || node.project_id !== projectId) return;
        removalSet.add(nodeId);
        movedCount += 1;
        updatedNodes[nodeId] = {
          ...node,
          parent_id: nodeId === expectedFirstMovedNodeId ? anchorNodeId : node.parent_id,
          branch_id: branchId,
          metadata: {
            ...node.metadata,
            natural_origin_branch_id: branchId,
          },
        };
      });

      const currentMainline = state.mainlines[projectId] || [];
      const currentNaturalMainline = state.naturalMainlines[projectId] || [];
      let nextMainline = currentMainline.filter((id) => !removalSet.has(id));
      let nextNaturalMainline = currentNaturalMainline.filter((id) => !removalSet.has(id));

      if (nextMainline.length === 0 && currentMainline.length > 0) {
        console.warn('[accept-branch] mainline would become empty after filtering moved nodes; recovering from anchor', {
          projectId,
          anchorNodeId,
          currentMainlineLength: currentMainline.length,
          removalSetSize: removalSet.size,
          movedIds: Array.from(removalSet),
        });
        const anchorNode = updatedNodes[anchorNodeId];
        if (anchorNode && anchorNode.project_id === projectId) {
          const anchorIdx = currentMainline.indexOf(anchorNodeId);
          if (anchorIdx !== -1) {
            nextMainline = currentMainline.slice(0, anchorIdx + 1).filter((id) => !removalSet.has(id));
          }
          if (nextMainline.length === 0) {
            updatedNodes[anchorNodeId] = { ...anchorNode, branch_id: null };
            nextMainline = [anchorNodeId];
          }
        }
      }

      const repairedMainline = ensureNonEmptyMainline(projectId, nextMainline, updatedNodes, [anchorNodeId]);
      if (repairedMainline.repairedNodeId) {
        const repairedNodeId = repairedMainline.repairedNodeId;
        const repairedNode = updatedNodes[repairedNodeId];
        if (repairedNode) {
          updatedNodes[repairedNodeId] = {
            ...repairedNode,
            branch_id: null,
            parent_id: repairedNode.parent_id === repairedNodeId ? null : repairedNode.parent_id,
          };
        }
        nextMainline = repairedMainline.mainline;
        if (nextNaturalMainline.length === 0) {
          nextNaturalMainline = [repairedNodeId];
        }
        console.warn('[mainline-repair] prevented empty mainline in acceptSuggestedBranch', {
          projectId,
          anchorNodeId,
          repairedNodeId,
          removalCount: removalSet.size,
        });
      }

      const mainlineNodeValidation = nextMainline.every((id) => {
        const n = updatedNodes[id];
        return n && n.project_id === projectId;
      });
      if (!mainlineNodeValidation && nextMainline.length > 0) {
        console.warn('[accept-branch] mainline contains invalid node references after accept', {
          projectId,
          nextMainline,
        });
        nextMainline = nextMainline.filter((id) => updatedNodes[id]?.project_id === projectId);
      }

      const updatedContext: ContextView = {
        ...context,
        base_path: branchId,
        included_nodes: [],
        excluded_nodes: [],
      };

      return {
        pastStructureSnapshots,
        futureStructureSnapshots: [],
        nodes: updatedNodes,
        branches: { ...state.branches, [branchId]: newBranch },
        naturalBranches: { ...state.naturalBranches, [branchId]: newBranch },
        mainlines: { ...state.mainlines, [projectId]: nextMainline },
        naturalMainlines: { ...state.naturalMainlines, [projectId]: nextNaturalMainline },
        contexts: { ...state.contexts, [context.context_id]: updatedContext },
      };
    });

    if (rejectedBecauseStale) {
      console.warn('[branch-accept] stale or invalid move list rejected', {
        projectId,
        anchorNodeId,
        nodeIdsToMove,
      });
      return null;
    }
    if (movedCount === 0) return null;
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
      const repairedMainline = ensureNonEmptyMainline(projectId, newMainline, state.nodes, [
        branch.anchor_node_id,
        ...currentMainline,
      ]);
      newMainline = repairedMainline.mainline;
      const newMainlineSet = new Set(newMainline);

      const updatedNodes: Record<string, Node> = { ...state.nodes };
      if (repairedMainline.repairedNodeId && updatedNodes[repairedMainline.repairedNodeId]) {
        const repairedNode = updatedNodes[repairedMainline.repairedNodeId];
        updatedNodes[repairedMainline.repairedNodeId] = {
          ...repairedNode,
          branch_id: null,
        };
        console.warn('[mainline-repair] prevented empty mainline in promoteBranch', {
          projectId,
          branchId,
          repairedNodeId: repairedMainline.repairedNodeId,
        });
      }
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

  returnToParentBranch: (projectId) => {
    set((state) => {
      const project = state.projects[projectId];
      if (!project) return state;
      const context = state.contexts[project.active_context_id];
      if (!context) return state;
      if (context.base_path === 'mainline') return state;

      const currentBranch = state.branches[context.base_path];
      const parentBasePath = currentBranch?.parent_branch_id ?? 'mainline';
      return {
        contexts: {
          ...state.contexts,
          [context.context_id]: {
            ...context,
            base_path: parentBasePath,
          },
        },
      };
    });
  },

  cycleNodeInclusionState: (projectId, nodeId) => {
    set((state) => {
      const project = state.projects[projectId];
      if (!project) return state;
      const context = state.contexts[project.active_context_id];
      if (!context) return state;
      const node = state.nodes[nodeId];
      if (!node || node.project_id !== projectId) return state;
      const resolvedMainline = (state.mainlines[projectId] || []).filter((id) => state.nodes[id]?.project_id === projectId);
      const naturalVisibleIds = resolveVisibleNodeIdsForBasePath(
        projectId,
        context.base_path,
        state.branches,
        state.nodes,
        resolvedMainline
      );

      let newIncluded = [...context.included_nodes];
      let newExcluded = [...context.excluded_nodes];
      const isExplicitlyIncluded = newIncluded.includes(nodeId);
      const isExplicitlyExcluded = newExcluded.includes(nodeId);
      const isNaturallyActive = naturalVisibleIds.has(nodeId);
      const isEffectivelyIncluded = (isNaturallyActive && !isExplicitlyExcluded) || isExplicitlyIncluded;

      newIncluded = newIncluded.filter((id) => id !== nodeId);
      newExcluded = newExcluded.filter((id) => id !== nodeId);

      if (isEffectivelyIncluded) {
        newExcluded.push(nodeId);
      } else {
        newIncluded.push(nodeId);
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

  toggleNodeInclusion: (projectId, nodeId) => {
    get().cycleNodeInclusionState(projectId, nodeId);
  },

  enablePatternForType: (projectId, contextId, type, patternId) => {
    set((state) => {
      const project = state.projects[projectId];
      if (!project) return state;
      const context = state.contexts[contextId];
      if (!context || context.project_id !== projectId) return state;
      const pattern = state.patterns[patternId];
      if (!pattern || pattern.type !== type) return state;

      return {
        contexts: {
          ...state.contexts,
          [context.context_id]: {
            ...context,
            enabled_patterns_by_type: {
              ...context.enabled_patterns_by_type,
              [type]: patternId,
            },
          },
        },
      };
    });
  },

  disablePatternForType: (projectId, contextId, type) => {
    set((state) => {
      const project = state.projects[projectId];
      if (!project) return state;
      const context = state.contexts[contextId];
      if (!context || context.project_id !== projectId) return state;

      const { [type]: _, ...restEnabled } = context.enabled_patterns_by_type;
      return {
        contexts: {
          ...state.contexts,
          [context.context_id]: {
            ...context,
            enabled_patterns_by_type: restEnabled,
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

  createPattern: ({
    type,
    name,
    requires_human_review,
    instruction,
    example,
    fromNodeId,
    toNodeId,
    sourceProjectId,
  }) => {
    const patternId = uuidv4();
    const now = new Date().toISOString();
    const newPattern: Pattern = {
      pattern_id: patternId,
      type,
      name,
      requires_human_review,
      instruction,
      example,
      review_status: requires_human_review ? 'pending' : 'approved',
      source_line: { from: fromNodeId, to: toNodeId },
      created_at: now,
      updated_at: now,
      created_from_project_id: sourceProjectId,
    };
    set((state) => ({
      patterns: { ...state.patterns, [patternId]: newPattern },
    }));
    void logPatternUpsert(newPattern);
    return patternId;
  },

  updatePattern: (patternId, patch) => {
    let nextPattern: Pattern | null = null;
    set((state) => {
      const existing = state.patterns[patternId];
      if (!existing) return state;
      nextPattern = {
        ...existing,
        ...patch,
        updated_at: new Date().toISOString(),
      };
      return {
        patterns: {
          ...state.patterns,
          [patternId]: nextPattern,
        },
      };
    });
    if (nextPattern) {
      void logPatternUpsert(nextPattern);
    }
  },

  approvePattern: (patternId) => {
    let nextPattern: Pattern | null = null;
    set((state) => {
      const existing = state.patterns[patternId];
      if (!existing) return state;
      nextPattern = {
        ...existing,
        review_status: 'approved',
        updated_at: new Date().toISOString(),
      };
      return {
        patterns: {
          ...state.patterns,
          [patternId]: nextPattern,
        },
      };
    });
    if (nextPattern) {
      void logPatternUpsert(nextPattern);
    }
  },

  deletePattern: (patternId) => {
    let deletedPattern: Pattern | null = null;
    set((state) => {
      deletedPattern = state.patterns[patternId] || null;
      if (!deletedPattern) return state;
      const { [patternId]: _, ...restPatterns } = state.patterns;
      const updatedContexts = Object.fromEntries(
        Object.entries(state.contexts).map(([contextId, ctx]) => {
          const nextEnabled = Object.fromEntries(
            Object.entries(ctx.enabled_patterns_by_type).filter(([, id]) => id !== patternId)
          ) as Partial<Record<PatternType, string>>;
          return [contextId, { ...ctx, enabled_patterns_by_type: nextEnabled }];
        })
      );
      return {
        patterns: restPatterns,
        contexts: updatedContexts,
      };
    });
    if (deletedPattern) {
      void logPatternDelete(deletedPattern);
    }
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
      const repairedMainline = ensureNonEmptyMainline(projectId, startToEnd, state.nodes, [startId, endId]);
      const newMainline = repairedMainline.mainline;
      const newMainlineSet = new Set(newMainline);

      const updatedNodes: Record<string, Node> = { ...state.nodes };
      const updatedBranches: Record<string, Branch> = { ...state.branches };
      if (repairedMainline.repairedNodeId && updatedNodes[repairedMainline.repairedNodeId]) {
        const repairedNode = updatedNodes[repairedMainline.repairedNodeId];
        updatedNodes[repairedMainline.repairedNodeId] = {
          ...repairedNode,
          branch_id: null,
        };
        console.warn('[mainline-repair] prevented empty mainline in setMainlineEndpoints', {
          projectId,
          startId,
          endId,
          repairedNodeId: repairedMainline.repairedNodeId,
        });
      }

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
            parent_branch_id: null,
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

  previewDeleteSelectedNodes: (projectId, nodeIds) => {
    return previewDeleteSelectedNodes(get(), projectId, nodeIds);
  },

  deleteSelectedNodes: (projectId, nodeIds) => {
    const planned = previewDeleteSelectedNodes(get(), projectId, nodeIds);
    if (!planned) return null;
    const stateBeforeDelete = get();
    const deletedNodes = nodeIds
      .map((nodeId) => stateBeforeDelete.nodes[nodeId])
      .filter((node): node is Node => !!node && node.project_id === projectId);
    const projectTitle = stateBeforeDelete.projects[projectId]?.title ?? null;

    set((state) => {
      const result = deriveDeleteSelectionStructure(state, projectId, nodeIds);
      if (!result) return state;
      const snapshot = pickStructure(state);
      const pastStructureSnapshots = [...state.pastStructureSnapshots, snapshot].slice(-MAX_STRUCTURE_HISTORY);
      return {
        projects: result.projects,
        nodes: result.nodes,
        branches: result.branches,
        mainlines: result.mainlines,
        contexts: result.contexts,
        naturalMainlines: result.naturalMainlines,
        naturalBranches: result.naturalBranches,
        deletedNodeIds: Array.from(new Set([...state.deletedNodeIds, ...nodeIds])),
        pastStructureSnapshots,
        futureStructureSnapshots: [],
      };
    });

    void logDeletedChatNodes(deletedNodes, { projectTitle });

    return planned;
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
      const repairedNaturalMainline = ensureNonEmptyMainline(projectId, naturalMainline, state.nodes, naturalMainline);
      const naturalMainlineSet = new Set(repairedNaturalMainline.mainline);
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
      if (repairedNaturalMainline.repairedNodeId && updatedNodes[repairedNaturalMainline.repairedNodeId]) {
        const repairedNode = updatedNodes[repairedNaturalMainline.repairedNodeId];
        updatedNodes[repairedNaturalMainline.repairedNodeId] = {
          ...repairedNode,
          branch_id: null,
        };
        console.warn('[mainline-repair] prevented empty mainline in resetStructureToNatural', {
          projectId,
          repairedNodeId: repairedNaturalMainline.repairedNodeId,
        });
      }

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
        mainlines: { ...state.mainlines, [projectId]: repairedNaturalMainline.mainline },
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

  startNodeSelectionMode: (intent) => {
    set({
      isNodeSelectionMode: true,
      nodeSelectionIntent: intent,
      selectedNodeIds: [],
    });
  },

  finishNodeSelectionMode: () => {
    set({
      isNodeSelectionMode: false,
      nodeSelectionIntent: 'batch',
      selectedNodeIds: [],
    });
  },

  clearNodeSelection: () => {
    set({ selectedNodeIds: [] });
  },

  toggleNodeSelection: (nodeId) => {
    set((state) => {
      const next = new Set(state.selectedNodeIds);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return { selectedNodeIds: Array.from(next) };
    });
  },

  applyNodeSelectionChanges: (changes) => {
    if (changes.length === 0) return;
    set((state) => ({
      selectedNodeIds: reconcileSelectedNodeIds(state.selectedNodeIds, changes.map((change) => ({
        type: 'select' as const,
        id: change.id,
        selected: change.selected,
      }))),
    }));
  },
};
}, {
  name: STORE_PERSIST_KEY,
  storage: createJSONStorage(() => userScopedStorage),
  partialize: (state) => ({
    projects: state.projects,
    nodes: state.nodes,
    branches: state.branches,
    mainlines: state.mainlines,
    contexts: state.contexts,
    patterns: state.patterns,
    naturalMainlines: state.naturalMainlines,
    naturalBranches: state.naturalBranches,
    deletedNodeIds: state.deletedNodeIds,
    activeProjectId: state.activeProjectId,
  }),
  merge: (persistedState, currentState) => {
    const persisted = persistedState as Partial<AppState>;
    const persistedPatternsRaw = (persisted.patterns as Record<string, any>) || {};
    const migratedPatterns = Object.fromEntries(
      Object.entries(persistedPatternsRaw).map(([patternId, pattern]) => {
        if (
          pattern &&
          typeof pattern === 'object' &&
          typeof pattern.instruction === 'string' &&
          typeof pattern.example === 'string' &&
          typeof pattern.name === 'string'
        ) {
          return [patternId, pattern];
        }
        const legacyGuidance = typeof pattern?.guidance_text === 'string' ? pattern.guidance_text : '';
        const legacySteps = Array.isArray(pattern?.steps) ? pattern.steps.filter((s: unknown) => typeof s === 'string') : [];
        const instructionBody = [
          legacyGuidance,
          legacySteps.length > 0
            ? `Legacy Steps:\n${legacySteps.map((step, idx) => `${idx + 1}. ${step}`).join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n\n');
        const now = new Date().toISOString();
        const migratedPattern: Pattern = {
          pattern_id: typeof pattern?.pattern_id === 'string' ? pattern.pattern_id : patternId,
          type: 'task_sop',
          name: typeof pattern?.name === 'string' ? pattern.name : 'Legacy Pattern',
          requires_human_review: true,
          instruction: instructionBody || 'Legacy guidance migrated from previous schema.',
          example: 'Legacy pattern migrated from previous schema.',
          review_status: 'pending',
          source_line:
            pattern?.source_line &&
            typeof pattern.source_line.from === 'string' &&
            typeof pattern.source_line.to === 'string'
              ? pattern.source_line
              : { from: '', to: '' },
          created_at: now,
          updated_at: now,
        };
        return [patternId, migratedPattern];
      })
    ) as Record<string, Pattern>;

    const migratedContexts = Object.fromEntries(
      Object.entries((persisted.contexts as Record<string, ContextView & {
        active_pattern?: string | null;
      }>) || {}).map(([contextId, ctx]) => {
        if ('enabled_patterns_by_type' in ctx && ctx.enabled_patterns_by_type) {
          return [contextId, ctx];
        }
        const migratedContext: ContextView = {
          ...ctx,
          enabled_patterns_by_type: {},
        };
        return [contextId, migratedContext];
      })
    ) as Record<string, ContextView>;

    const merged = {
      ...currentState,
      ...persisted,
      patterns: Object.keys(migratedPatterns).length > 0 ? migratedPatterns : currentState.patterns,
      contexts: Object.keys(migratedContexts).length > 0 ? migratedContexts : currentState.contexts,
      pastStructureSnapshots: [],
      futureStructureSnapshots: [],
    } as AppState;
    const currentHasSeededProjects = Object.keys(currentState.projects).length > 0;
    const mergedHasProjects = Object.keys(merged.projects).length > 0;
    if (currentHasSeededProjects && !mergedHasProjects) {
      merged.projects = currentState.projects;
      merged.nodes = currentState.nodes;
      merged.branches = currentState.branches;
      merged.mainlines = currentState.mainlines;
      merged.contexts = currentState.contexts;
      merged.naturalMainlines = currentState.naturalMainlines;
      merged.naturalBranches = currentState.naturalBranches;
      merged.deletedNodeIds = currentState.deletedNodeIds;
      merged.activeProjectId = currentState.activeProjectId;
    }
    if (!merged.activeProjectId || !merged.projects[merged.activeProjectId]) {
      merged.activeProjectId = Object.keys(merged.projects)[0] || null;
    }
    return merged;
  },
}));

export const rehydrateStoreForActiveUser = async () => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  await useAppStore.persist.rehydrate();
};

export const mergePatternsFromRemoteRecords = (remoteRecords: PatternSyncRecord[]) => {
  if (remoteRecords.length === 0) return;

  useAppStore.setState((state) => {
    const nextPatterns = mergeRemotePatternsIntoPatterns(state.patterns, remoteRecords);
    const nextPatternIds = new Set(Object.keys(nextPatterns));
    const nextContexts = Object.fromEntries(
      Object.entries(state.contexts).map(([contextId, context]) => {
        const nextEnabled = Object.fromEntries(
          Object.entries(context.enabled_patterns_by_type).filter(([, patternId]) => nextPatternIds.has(patternId))
        ) as Partial<Record<PatternType, string>>;
        return [contextId, { ...context, enabled_patterns_by_type: nextEnabled }];
      })
    );

    return {
      patterns: nextPatterns,
      contexts: nextContexts,
    };
  });
};

export const mergeRecoveredChatStateIntoStore = (recoveredState: RecoveredChatState) => {
  useAppStore.setState((state) => {
    const mergedDeletedNodeIds = Array.from(new Set([
      ...state.deletedNodeIds,
      ...recoveredState.deletedNodeIds,
    ]));
    const filteredRecoveredState = filterRecoveredChatStateByDeletedNodeIds(
      recoveredState,
      mergedDeletedNodeIds
    );
    const merged = mergeRecoveredChatState(
      {
        projects: state.projects,
        nodes: state.nodes,
        branches: state.branches,
        mainlines: state.mainlines,
        contexts: state.contexts,
        naturalMainlines: state.naturalMainlines,
        naturalBranches: state.naturalBranches,
        patterns: state.patterns,
        pastStructureSnapshots: [],
        futureStructureSnapshots: [],
        deletedNodeIds: state.deletedNodeIds,
        activeProjectId: state.activeProjectId,
      },
      filteredRecoveredState
    );

    return {
      projects: merged.projects,
      nodes: merged.nodes,
      branches: merged.branches,
      mainlines: merged.mainlines,
      contexts: merged.contexts,
      naturalMainlines: merged.naturalMainlines,
      naturalBranches: merged.naturalBranches,
      deletedNodeIds: mergedDeletedNodeIds,
      activeProjectId: merged.activeProjectId,
    };
  });
};
