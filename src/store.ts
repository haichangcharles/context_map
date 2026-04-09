import { create } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { Project, Node, Branch, ContextView, Pattern, PatternType, Role, DeleteSelectionPreview, SelectionIntent } from './types';
import { logDeletedChatNodes, mergeRecoveredChatState, syncProjectRename, type RecoveredChatState } from './services/chatHistory';
import { logPatternDelete, logPatternUpsert, mergeRemotePatternsIntoPatterns, type PatternSyncRecord } from './services/patternSync';
import { reconcileSelectedNodeIds, resolveNodeSelectionClick } from './utils/selectionState';

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

type NodeInclusionAction = 'include' | 'exclude' | 'natural' | 'invert';
type CareerCaseStage = 'stage1' | 'stage2' | 'stage3' | 'stage4';

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
  importTutorialProject: (language?: 'zh' | 'en') => string;
  importCareerCaseProject: (stage?: CareerCaseStage, language?: 'zh' | 'en') => string;
  setActiveProject: (projectId: string) => void;
  renameProject: (projectId: string, newTitle: string) => void;
  deleteProject: (projectId: string) => void;
  
  addNode: (
    projectId: string,
    parentId: string | null,
    role: Role,
    content: string,
    branchId: string | null,
    timestampOverride?: string
  ) => string;
  updateNodeContent: (nodeId: string, content: string, mode?: 'replace' | 'append') => void;
  editNodeContent: (nodeId: string, content: string) => void;
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
  updateBranchCompletionSummary: (branchId: string, summary: string) => void;
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
  batchToggleInclusion: (projectId: string, nodeIds: string[], action: NodeInclusionAction) => void;
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
  toggleNodeSelection: (nodeId: string, additive?: boolean) => void;
  applyNodeSelectionChanges: (changes: Array<{ id: string; selected: boolean }>) => void;
}

const EXAMPLE_PROJECT_ID = 'example-project';
const EXAMPLE_CONTEXT_ID = 'example-context';
const EXAMPLE_BRANCH_RESEARCH = 'example-branch-research';
const EXAMPLE_BRANCH_ARCH = 'example-branch-architecture';
const EXAMPLE_BRANCH_UI = 'example-branch-ui';
const TUTORIAL_PROJECT_TITLE = 'Tutorial - Learn Context Map';
const TUTORIAL_PROJECT_TITLE_ZH = '教程 - 学习 Context Map';
const CAREER_CASE_PROJECT_TITLE = 'Career Transition Case';
const CAREER_CASE_PROJECT_TITLE_ZH = '职业转型案例';

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

type PresetProjectBundle = {
  project: Project;
  nodes: Record<string, Node>;
  branches: Record<string, Branch>;
  mainline: string[];
  context: ContextView;
  naturalBranches: Record<string, Branch>;
  patterns: Record<string, Pattern>;
  selectionState: {
    isNodeSelectionMode: boolean;
    nodeSelectionIntent: SelectionIntent;
    selectedNodeIds: string[];
  };
};

const buildTutorialProjectBundle = (input: {
  projectId: string;
  contextId: string;
  prefix: string;
  language?: 'zh' | 'en';
  title?: string;
}): PresetProjectBundle => {
  const language = input.language ?? 'en';
  const { projectId, contextId, prefix, title = language === 'zh' ? TUTORIAL_PROJECT_TITLE_ZH : TUTORIAL_PROJECT_TITLE } = input;
  const nodeId = (suffix: string) => `${prefix}-${suffix}`;
  const branchId = (suffix: string) => `${prefix}-${suffix}`;
  const timestamp = (minuteOffset: number) => `2026-02-27T09:${String(minuteOffset).padStart(2, '0')}:00.000Z`;

  const ids = {
    n1: nodeId('n1'),
    n2: nodeId('n2'),
    n3: nodeId('n3'),
    n4: nodeId('n4'),
    n5: nodeId('n5'),
    n6: nodeId('n6'),
    r1: nodeId('r1'),
    r2: nodeId('r2'),
    a1: nodeId('a1'),
    a2: nodeId('a2'),
    u1: nodeId('u1'),
    u2: nodeId('u2'),
    branchResearch: branchId('branch-research'),
    branchNested: branchId('branch-nested-return'),
    branchExtract: branchId('branch-extract'),
  };

  const content =
    language === 'zh'
      ? {
          n1: '我是第一次打开 Context Map。你可以把它变成一个教程，然后像陪我一起操作那样教我吗？',
          n2: '可以。你现在看到的是主线，也就是默认正在推进的路径。先把这条路径从上往下读一遍。右边的 Context Map 会显示同一条结构，但你现在先专注看聊天流。读完以后，回来继续下一条。',
          n3: '我已经读完主线了。下一步做什么？',
          n4: '现在看主线里第 4 个 assistant 节点，预览文字是 `现在看主线里第 4 个 assista...`。先把鼠标悬停在上一条 assistant 消息上。你应该会看到一个 `Branch` 动作。点一下 `Branch`，从那条消息开一个 side branch。如果你之后不知道该切到哪条 branch，就去右侧画布，找到从这个节点分出去的两条分支线：右边第一张卡片预览是 `我已经进入右侧那条 branch ...`，左边第一张卡片预览是 `我试过了。除了 branch 之外...`。选中对应节点后右键，再点 `Locate`。做完以后，回来继续下一条。',
          n5: '我试过了。除了 branch 之外，我接下来应该注意什么？',
          n6: '接下来你会看到返回和 suggestion。右侧那条 branch 主要带你看返回，入口节点预览是 `我已经进入右侧那条 branch ...`；左侧那条 branch 主要带你体验 suggestion 和 SOP，入口节点预览是 `我试过了。除了 branch 之外...`。如果你想继续 suggestion 这条线，就沿着左侧往下，先找到 `我已经切到左侧那条 branch ...`，再继续到更下面的 assistant 节点。读完以后，先去左侧那条 branch，再自己发一句很短的话来触发一次建议。',
          r1: '我已经进入右侧那条 branch 了，也就是右边第一张预览为 `我已经进入右侧那条 branch ...` 的节点。现在先看哪里？',
          r2: '先看聊天区域顶部。你应该能看到返回主线（`Return to Mainline`）。当你想离开这个 branch、回到默认主线时，就用它。你现在可以点一次试试。返回以后，如果你想继续看更深一层的返回逻辑，就回到右侧这条 branch，再往下找到下一张预览为 `如果我已经在更深一层的 bra...` 的节点。',
          a1: '如果我已经在更深一层的 branch 里，只想回上一层怎么办？你现在要找的就是右侧 branch 再往下那张预览为 `如果我已经在更深一层的 bra...` 的节点；再往下读，你会看到 assistant 节点预览是 `这时候看返回上一级（`Retu...`。',
          a2: '这时候看返回上一级（`Return to Parent`）。它的作用是返回上一级，而不是直接回主线。你现在可以试一次。回来以后，继续顺着刚刚的 branch 往下读，然后再回主线进入下一步。',
          u1: '我已经切到左侧那条 branch 了，也就是左边往下那张预览为 `我已经切到左侧那条 branch ...` 的节点。再继续往下，你会看到 assistant 节点预览是 `留意 assistant 消息下面的 s...`。我在这个 branch 里看到一段可复用的方法。我要怎么把它留下来？',
          u2: '留意 assistant 消息下面的 suggestion 卡片。如果你想亲手触发一次，就在输入框直接发送：`把这段整理成可复用 SOP`。如果你看到 `Extract Reasoning` 或提炼 SOP（`Extract SOP`），点一下试试看；如果你不想接受，也可以点 `Reject`。做完以后，对照原来的对话和结果，看看系统到底提炼了什么。然后回到主线，继续你自己的 follow-up question。',
          branchResearchSummary: '如何从消息开 branch，并返回主线？',
          branchNestedSummary: 'Return to Parent 和 Return to Mainline 有什么区别？',
          branchExtractSummary: '如何处理 inline extraction suggestion？',
        }
      : {
          n1: 'I am opening Context Map for the first time. Can you turn this into a tutorial and teach me like we are doing it together?',
          n2: 'Yes. Start here on the mainline. Read this path from top to bottom now. Then glance at the Context Map on the right so you can see that it mirrors the same structure. When you finish, come back and read the next message.',
          n3: 'I have read the mainline once. What should I do next?',
          n4: 'Now look at the 4th assistant node on the mainline. Its preview text is `Now look at the 4th assista...`. Hover over the previous assistant message in the chat. You should see a small `Branch` action appear next to it. Click `Branch` to open a side path from that message. If you later do not know which branch to enter, go to the Context Map and look for the two branch entry nodes below this point: the right one starts with `I am inside the branch on the right...`, and the left one starts with `I tried that. Besides branching...`. Select the one you want, right-click, and use `Locate`. After you do that, come back and read the next line.',
          n5: 'I tried that. Besides branching, what other suggestions should I watch for while I use the system?',
          n6: 'You may see suggestions such as branch, return_parent, extract_reasoning, and extract_task_sop. The branch on the right is mainly for return controls, and its entry node starts with `I am inside the branch on the right...`. The branch on the left is mainly for suggestion and SOP practice, and its entry node starts with `I tried that. Besides branching...`. If you want to continue the suggestion path, stay on the left side and move downward to the node that starts with `I have switched to the branch on the left...`, then continue to the assistant node below it. After you read them, go to the left branch and send one short message of your own.',
          r1: 'I am inside the branch on the right now, which is the first node on the right that starts with `I am inside the branch on the right...`. What should I look at first?',
          r2: 'Look at the top bar of the chat first. You should see `Return to Mainline` there. Use that button when you want to leave this branch and continue the default path. Click it once to test it. After that, if you want to continue the deeper return example, come back to this branch on the right and keep reading downward until you reach the next node that starts with `What if I am already inside...`.',
          a1: 'What if I am already inside a nested branch and I only want to go up one level? The node you want next is the lower node on the right that starts with `What if I am already inside...`. Below that, the assistant node starts with `That is when `Return to Parent`...`.',
          a2: 'That is when `Return to Parent` helps. Use it when you want to go one level up instead of all the way back to mainline. Try that control now. When you come back, keep following the tutorial from the branch you returned to, then head back to the mainline for the next step.',
          u1: 'I have switched to the branch on the left, which is the lower-left node that starts with `I have switched to the branch on the left...`. Below that, the assistant node starts with `Watch the assistant message area...`. I found a reusable method in this branch. How do I save something useful from it?',
          u2: 'Watch the assistant message area for inline suggestion cards. If you want to trigger one yourself, send this exact line: `Turn this into a reusable SOP.` If you see `Extract Reasoning` or `Extract SOP`, click one of them. If you do not want it, click `Reject`. After that, compare the extracted result with the source conversation, then return to the mainline and continue with your own follow-up question.',
          branchResearchSummary: 'How do you open a branch from a message and return to mainline?',
          branchNestedSummary: 'How does Return to Parent differ from Return to Mainline?',
          branchExtractSummary: 'How do inline extraction suggestions work?',
        };

  const nodes: Record<string, Node> = {
    [ids.n1]: {
      node_id: ids.n1,
      project_id: projectId,
      parent_id: null,
      role: 'user',
      content: content.n1,
      branch_id: null,
      timestamp: timestamp(0),
      metadata: {},
    },
    [ids.n2]: {
      node_id: ids.n2,
      project_id: projectId,
      parent_id: ids.n1,
      role: 'assistant',
      content: content.n2,
      branch_id: null,
      timestamp: timestamp(1),
      metadata: {},
    },
    [ids.n3]: {
      node_id: ids.n3,
      project_id: projectId,
      parent_id: ids.n2,
      role: 'user',
      content: content.n3,
      branch_id: null,
      timestamp: timestamp(2),
      metadata: {},
    },
    [ids.n4]: {
      node_id: ids.n4,
      project_id: projectId,
      parent_id: ids.n3,
      role: 'assistant',
      content: content.n4,
      branch_id: null,
      timestamp: timestamp(3),
      metadata: {},
    },
    [ids.n5]: {
      node_id: ids.n5,
      project_id: projectId,
      parent_id: ids.n4,
      role: 'user',
      content: content.n5,
      branch_id: null,
      timestamp: timestamp(4),
      metadata: {},
    },
    [ids.n6]: {
      node_id: ids.n6,
      project_id: projectId,
      parent_id: ids.n5,
      role: 'assistant',
      content: content.n6,
      branch_id: null,
      timestamp: timestamp(5),
      metadata: {},
    },
    [ids.r1]: {
      node_id: ids.r1,
      project_id: projectId,
      parent_id: ids.n4,
      role: 'user',
      content: content.r1,
      branch_id: ids.branchResearch,
      timestamp: timestamp(6),
      metadata: {},
    },
    [ids.r2]: {
      node_id: ids.r2,
      project_id: projectId,
      parent_id: ids.r1,
      role: 'assistant',
      content: content.r2,
      branch_id: ids.branchResearch,
      timestamp: timestamp(7),
      metadata: {},
    },
    [ids.a1]: {
      node_id: ids.a1,
      project_id: projectId,
      parent_id: ids.r2,
      role: 'user',
      content: content.a1,
      branch_id: ids.branchNested,
      timestamp: timestamp(8),
      metadata: {},
    },
    [ids.a2]: {
      node_id: ids.a2,
      project_id: projectId,
      parent_id: ids.a1,
      role: 'assistant',
      content: content.a2,
      branch_id: ids.branchNested,
      timestamp: timestamp(9),
      metadata: {},
    },
    [ids.u1]: {
      node_id: ids.u1,
      project_id: projectId,
      parent_id: ids.n6,
      role: 'user',
      content: content.u1,
      branch_id: ids.branchExtract,
      timestamp: timestamp(10),
      metadata: {},
    },
    [ids.u2]: {
      node_id: ids.u2,
      project_id: projectId,
      parent_id: ids.u1,
      role: 'assistant',
      content: content.u2,
      branch_id: ids.branchExtract,
      timestamp: timestamp(11),
      metadata: {},
    },
  };

  const branches: Record<string, Branch> = {
    [ids.branchResearch]: {
      branch_id: ids.branchResearch,
      project_id: projectId,
      anchor_node_id: ids.n4,
      parent_branch_id: null,
      status: 'active',
      intent_summary: content.branchResearchSummary,
    },
    [ids.branchNested]: {
      branch_id: ids.branchNested,
      project_id: projectId,
      anchor_node_id: ids.r2,
      parent_branch_id: ids.branchResearch,
      status: 'active',
      intent_summary: content.branchNestedSummary,
    },
    [ids.branchExtract]: {
      branch_id: ids.branchExtract,
      project_id: projectId,
      anchor_node_id: ids.n6,
      parent_branch_id: null,
      status: 'active',
      intent_summary: content.branchExtractSummary,
    },
  };

  const mainline = [ids.n1, ids.n2, ids.n3, ids.n4, ids.n5, ids.n6];

  return {
    project: {
      project_id: projectId,
      title,
      root_node_id: ids.n1,
      mainline_id: `mainline_${projectId}`,
      active_context_id: contextId,
    },
    nodes,
    branches,
    mainline,
    context: {
      context_id: contextId,
      project_id: projectId,
      base_path: 'mainline',
      included_nodes: [],
      excluded_nodes: [],
      enabled_patterns_by_type: {},
    },
    naturalBranches: branches,
    patterns: {},
    selectionState: {
      isNodeSelectionMode: false,
      nodeSelectionIntent: 'batch',
      selectedNodeIds: [],
    },
  };
};

const buildCareerCaseProjectBundle = (input: {
  projectId: string;
  contextId: string;
  prefix: string;
  stage?: CareerCaseStage;
  language?: 'zh' | 'en';
  title?: string;
}): PresetProjectBundle => {
  const language = input.language ?? 'en';
  const stage = input.stage ?? 'stage1';
  const resolveTitle = () => {
    const zhTitles: Record<CareerCaseStage, string> = {
      stage1: `${CAREER_CASE_PROJECT_TITLE_ZH} · 阶段 1 · 编辑与分叉`,
      stage2: `${CAREER_CASE_PROJECT_TITLE_ZH} · 阶段 2 · 污染与排除`,
      stage3: `${CAREER_CASE_PROJECT_TITLE_ZH} · 阶段 3 · 切线待删除`,
      stage4: `${CAREER_CASE_PROJECT_TITLE_ZH} · 阶段 4 · 主线与 SOP`,
    };
    const enTitles: Record<CareerCaseStage, string> = {
      stage1: `${CAREER_CASE_PROJECT_TITLE} · Stage 1 · Edit + Branching`,
      stage2: `${CAREER_CASE_PROJECT_TITLE} · Stage 2 · Pollution + Exclude`,
      stage3: `${CAREER_CASE_PROJECT_TITLE} · Stage 3 · Tangent Ready to Delete`,
      stage4: `${CAREER_CASE_PROJECT_TITLE} · Stage 4 · PM Mainline + SOP`,
    };
    return input.title ?? (language === 'zh' ? zhTitles[stage] : enTitles[stage]);
  };
  const { projectId, contextId, prefix } = input;
  const title = resolveTitle();
  const nodeId = (suffix: string) => `${prefix}-${suffix}`;
  const branchId = (suffix: string) => `${prefix}-${suffix}`;
  const patternId = (suffix: string) => `${prefix}-${suffix}`;
  const timestamp = (minuteOffset: number) => `2026-03-31T14:${String(minuteOffset).padStart(2, '0')}:00.000Z`;

  const ids = {
    m1: nodeId('m1'),
    m2: nodeId('m2'),
    m3: nodeId('m3'),
    m4: nodeId('m4'),
    a1: nodeId('a1'),
    a2: nodeId('a2'),
    a3: nodeId('a3'),
    a4: nodeId('a4'),
    p1: nodeId('p1'),
    p2: nodeId('p2'),
    p3: nodeId('p3'),
    p4: nodeId('p4'),
    p5: nodeId('p5'),
    p6: nodeId('p6'),
    t1: nodeId('t1'),
    t2: nodeId('t2'),
    t3: nodeId('t3'),
    t4: nodeId('t4'),
    branchAnalyst: branchId('branch-analyst'),
    branchPm: branchId('branch-pm'),
    branchTangent: branchId('branch-pmp'),
    taskSop: patternId('pattern-task-sop'),
  };

  const content =
    language === 'zh'
      ? {
          m1: '我在准备跨职能岗位的求职材料。先从 data analyst 面试技巧开始，但我也可能转向 PM。',
          m2: '已修订的简历摘要：擅长 SQL、实验分析、仪表盘叙事、跨团队沟通与产品判断。虚构的编程技能条目已被删除，只保留已确认经历。',
          m3: '我越来越觉得 PM 更适合我。先帮我把 analyst 路径和 PM 路径拆开比较。',
          m4: '这已经是明显的意图偏移。保留 analyst 路径做参考，同时单独开一条 PM 分支，避免两个方向互相污染。',
          a1: '继续沿着 data analyst 方向帮我准备。',
          a2: '可以重点练 SQL case、Python web scraping、data cleaning automation，以及 dashboard QA 故事。',
          a3: '还有哪些偏技术的例子要准备？',
          a4: '再准备 A/B test design critique、metric definition、ETL debugging，以及 notebook-based analysis walkthrough。',
          p1: '现在切到 PM 分支。',
          p2: '好的，我会改成 PM 视角：聚焦 product sense、stakeholder alignment、roadmap trade-offs、prioritization framework，以及跨职能推进。',
          p3: '但前面的 analyst 历史还在污染回答，总把我拉回 coding 和 data tooling。',
          p4: '那就把 analyst-heavy 的节点批量排除出当前推理范围。这样 PM 路径就不会再继承技术实现偏好。',
          p5: '好，继续。帮我整理一版 PM behavioral interview 的 STAR 模板。',
          p6: 'STAR 模板：Situation 说明背景与业务约束；Task 说明你负责的产品问题；Action 强调调研、对齐、优先级取舍与推动落地；Result 量化影响并说明关键学习。',
          t1: '临时问题：PMP certification exam registration process 是什么？',
          t2: '通常要先创建 PMI 账号、确认资格、提交申请、支付费用，再安排考试时间。',
          t3: '这个要不要在面试前就做？',
          t4: '它对职业发展有帮助，但对当前 PM interview workflow 不是核心，所以更适合作为临时支线处理。',
          branchAnalystSummary: '保留原始 data analyst 方向，用来对比，但后续会被移出 PM 推理范围。',
          branchPmSummary: '转向 PM 的核心路径，强调产品思维而不是技术实现。',
          branchTangentSummary: '与 PMP 报名相关的临时支线，适合后续删除或移出主任务。',
          taskSopName: '职业转型面试工作流',
          taskSopInstruction:
            '1. 审查简历里是否有虚构或过时表述。 2. 当目标岗位改变时显式切分新路径。 3. 批量排除旧角色带来的上下文污染。 4. 在新主线上生成岗位叙事与面试材料。 5. 提炼 STAR 模板并保存为可复用 SOP。',
          taskSopExample:
            '输入：我想从数据分析转向 PM。输出：先修正简历事实，再排除 analyst-heavy 历史，最后生成 STAR 回答模板。',
        }
      : {
          m1: 'I am preparing materials for cross-functional interviews. Start with data analyst techniques, but I may pivot into product management.',
          m2: 'Edited resume summary: strong in SQL, experimentation, dashboard storytelling, stakeholder communication, and product judgment. The fabricated programming-skill claim has been removed.',
          m3: 'I am increasingly convinced PM fits me better. Split the analyst path from the PM path so I can compare them cleanly.',
          m4: 'This is a clear intent shift. Keep the analyst track as a reference path and open a separate PM branch so the two narratives stop contaminating each other.',
          a1: 'Keep coaching me on the data analyst track.',
          a2: 'Practice SQL case questions, Python web scraping for messy sources, data cleaning automation, and dashboard QA stories.',
          a3: 'What other technical examples should I keep ready?',
          a4: 'Prepare A/B test design critiques, metric definition trade-offs, ETL debugging stories, and notebook-based analysis walkthroughs.',
          p1: 'Switch me onto the PM branch now.',
          p2: 'Understood. I will keep the PM path centered on product sense, stakeholder alignment, roadmap trade-offs, prioritization frameworks, and cross-functional leadership.',
          p3: 'The analyst history is still leaking into the PM answers.',
          p4: 'Then isolate that baggage. Batch-exclude the analyst-heavy nodes so the PM reasoning scope stops inheriting coding and tooling assumptions.',
          p5: 'Good. Keep going and draft a STAR response template for PM interviews.',
          p6: 'STAR template: Situation frames the business context and constraints; Task defines the product problem you owned; Action highlights research, alignment, prioritization, and execution; Result quantifies the impact and the learning.',
          t1: 'Quick tangent: what is the PMP certification exam registration process?',
          t2: 'Usually you create a PMI account, confirm eligibility, submit the application, pay the fee, then schedule the exam.',
          t3: 'Should I do that before interviews?',
          t4: 'It may help long-term career development, but it is not central to this PM interview workflow, so it works better as a temporary side branch.',
          branchAnalystSummary: 'Original data-analyst direction kept for comparison, then pushed out of the PM reasoning scope.',
          branchPmSummary: 'The main PM exploration path centered on product thinking rather than implementation.',
          branchTangentSummary: 'A temporary PMP-registration tangent that is better handled as a disposable side branch.',
          taskSopName: 'Career Transition Interview Workflow',
          taskSopInstruction:
            '1. Audit the resume for fabricated or stale claims. 2. Split a new path when the target role changes. 3. Batch-exclude history that keeps dragging the model toward the old role. 4. Rebuild the narrative on the new mainline. 5. Generate a STAR template and save the workflow as a reusable SOP.',
          taskSopExample:
            'Input: I want to move from analytics into PM. Output: correct the resume facts, exclude analyst-heavy history, then generate PM interview materials and a STAR response template.',
        };

  const createNode = (
    id: string,
    parentId: string | null,
    role: Role,
    nodeContent: string,
    branchIdValue: string | null,
    minuteOffset: number,
    metadata: Node['metadata'] = {}
  ): Node => ({
    node_id: id,
    project_id: projectId,
    parent_id: parentId,
    role,
    content: nodeContent,
    branch_id: branchIdValue,
    timestamp: timestamp(minuteOffset),
    metadata: {
      natural_origin_branch_id: branchIdValue ?? null,
      ...metadata,
    },
  });

  const baseMainlineNodes: Record<string, Node> = {
    [ids.m1]: createNode(ids.m1, null, 'user', content.m1, null, 0),
    [ids.m2]: createNode(ids.m2, ids.m1, 'assistant', content.m2, null, 1, {
      edited_at: timestamp(2),
    }),
    [ids.m3]: createNode(ids.m3, ids.m2, 'user', content.m3, null, 3),
    [ids.m4]: createNode(ids.m4, ids.m3, 'assistant', content.m4, null, 4),
  };

  const analystNodes: Record<string, Node> = {
    [ids.a1]: createNode(ids.a1, ids.m4, 'user', content.a1, ids.branchAnalyst, 10),
    [ids.a2]: createNode(ids.a2, ids.a1, 'assistant', content.a2, ids.branchAnalyst, 11),
    [ids.a3]: createNode(ids.a3, ids.a2, 'user', content.a3, ids.branchAnalyst, 12),
    [ids.a4]: createNode(ids.a4, ids.a3, 'assistant', content.a4, ids.branchAnalyst, 13),
  };

  const pmBranchNodes: Record<string, Node> = {
    [ids.p1]: createNode(ids.p1, ids.m4, 'user', content.p1, ids.branchPm, 20),
    [ids.p2]: createNode(ids.p2, ids.p1, 'assistant', content.p2, ids.branchPm, 21),
    [ids.p3]: createNode(ids.p3, ids.p2, 'user', content.p3, ids.branchPm, 22),
    [ids.p4]: createNode(ids.p4, ids.p3, 'assistant', content.p4, ids.branchPm, 23),
    [ids.p5]: createNode(ids.p5, ids.p4, 'user', content.p5, ids.branchPm, 28),
    [ids.p6]: createNode(ids.p6, ids.p5, 'assistant', content.p6, ids.branchPm, 29),
  };

  const pmMainlineNodes: Record<string, Node> = {
    [ids.p1]: createNode(ids.p1, ids.m4, 'user', content.p1, null, 20),
    [ids.p2]: createNode(ids.p2, ids.p1, 'assistant', content.p2, null, 21),
    [ids.p3]: createNode(ids.p3, ids.p2, 'user', content.p3, null, 22),
    [ids.p4]: createNode(ids.p4, ids.p3, 'assistant', content.p4, null, 23),
    [ids.p5]: createNode(ids.p5, ids.p4, 'user', content.p5, null, 28),
    [ids.p6]: createNode(ids.p6, ids.p5, 'assistant', content.p6, null, 29),
  };

  const tangentNodes: Record<string, Node> = {
    [ids.t1]: createNode(ids.t1, ids.p2, 'user', content.t1, ids.branchTangent, 24),
    [ids.t2]: createNode(ids.t2, ids.t1, 'assistant', content.t2, ids.branchTangent, 25),
    [ids.t3]: createNode(ids.t3, ids.t2, 'user', content.t3, ids.branchTangent, 26),
    [ids.t4]: createNode(ids.t4, ids.t3, 'assistant', content.t4, ids.branchTangent, 27),
  };

  const stageNodes: Record<CareerCaseStage, Record<string, Node>> = {
    stage1: {
      ...baseMainlineNodes,
      ...analystNodes,
      ...pmBranchNodes,
      ...tangentNodes,
    },
    stage2: {
      ...baseMainlineNodes,
      ...analystNodes,
      ...pmBranchNodes,
      ...tangentNodes,
    },
    stage3: {
      ...baseMainlineNodes,
      ...analystNodes,
      ...pmBranchNodes,
      ...tangentNodes,
    },
    stage4: {
      ...baseMainlineNodes,
      ...analystNodes,
      ...pmMainlineNodes,
      ...tangentNodes,
    },
  };

  const stageBranches: Record<CareerCaseStage, Record<string, Branch>> = {
    stage1: {
      [ids.branchAnalyst]: {
        branch_id: ids.branchAnalyst,
        project_id: projectId,
        anchor_node_id: ids.m4,
        parent_branch_id: null,
        status: 'active',
        intent_summary: content.branchAnalystSummary,
      },
      [ids.branchPm]: {
        branch_id: ids.branchPm,
        project_id: projectId,
        anchor_node_id: ids.m4,
        parent_branch_id: null,
        status: 'active',
        intent_summary: content.branchPmSummary,
      },
      [ids.branchTangent]: {
        branch_id: ids.branchTangent,
        project_id: projectId,
        anchor_node_id: ids.p2,
        parent_branch_id: ids.branchPm,
        status: 'active',
        intent_summary: content.branchTangentSummary,
      },
    },
    stage2: {
      [ids.branchAnalyst]: {
        branch_id: ids.branchAnalyst,
        project_id: projectId,
        anchor_node_id: ids.m4,
        parent_branch_id: null,
        status: 'active',
        intent_summary: content.branchAnalystSummary,
      },
      [ids.branchPm]: {
        branch_id: ids.branchPm,
        project_id: projectId,
        anchor_node_id: ids.m4,
        parent_branch_id: null,
        status: 'active',
        intent_summary: content.branchPmSummary,
      },
      [ids.branchTangent]: {
        branch_id: ids.branchTangent,
        project_id: projectId,
        anchor_node_id: ids.p2,
        parent_branch_id: ids.branchPm,
        status: 'active',
        intent_summary: content.branchTangentSummary,
      },
    },
    stage3: {
      [ids.branchAnalyst]: {
        branch_id: ids.branchAnalyst,
        project_id: projectId,
        anchor_node_id: ids.m4,
        parent_branch_id: null,
        status: 'active',
        intent_summary: content.branchAnalystSummary,
      },
      [ids.branchPm]: {
        branch_id: ids.branchPm,
        project_id: projectId,
        anchor_node_id: ids.m4,
        parent_branch_id: null,
        status: 'active',
        intent_summary: content.branchPmSummary,
      },
      [ids.branchTangent]: {
        branch_id: ids.branchTangent,
        project_id: projectId,
        anchor_node_id: ids.p2,
        parent_branch_id: ids.branchPm,
        status: 'active',
        intent_summary: content.branchTangentSummary,
      },
    },
    stage4: {
      [ids.branchAnalyst]: {
        branch_id: ids.branchAnalyst,
        project_id: projectId,
        anchor_node_id: ids.m4,
        parent_branch_id: null,
        status: 'active',
        intent_summary: content.branchAnalystSummary,
      },
      [ids.branchTangent]: {
        branch_id: ids.branchTangent,
        project_id: projectId,
        anchor_node_id: ids.p2,
        parent_branch_id: null,
        status: 'active',
        intent_summary: content.branchTangentSummary,
      },
    },
  };

  const stageMainlines: Record<CareerCaseStage, string[]> = {
    stage1: [ids.m1, ids.m2, ids.m3, ids.m4],
    stage2: [ids.m1, ids.m2, ids.m3, ids.m4],
    stage3: [ids.m1, ids.m2, ids.m3, ids.m4],
    stage4: [ids.m1, ids.m2, ids.m3, ids.m4, ids.p1, ids.p2, ids.p3, ids.p4, ids.p5, ids.p6],
  };

  const stageContexts: Record<CareerCaseStage, ContextView> = {
    stage1: {
      context_id: contextId,
      project_id: projectId,
      base_path: ids.branchPm,
      included_nodes: [],
      excluded_nodes: [],
      enabled_patterns_by_type: {},
    },
    stage2: {
      context_id: contextId,
      project_id: projectId,
      base_path: ids.branchPm,
      included_nodes: [],
      excluded_nodes: [],
      enabled_patterns_by_type: {},
    },
    stage3: {
      context_id: contextId,
      project_id: projectId,
      base_path: ids.branchPm,
      included_nodes: [],
      excluded_nodes: [ids.a1, ids.a2, ids.a3, ids.a4],
      enabled_patterns_by_type: {},
    },
    stage4: {
      context_id: contextId,
      project_id: projectId,
      base_path: 'mainline',
      included_nodes: [],
      excluded_nodes: [ids.a1, ids.a2, ids.a3, ids.a4],
      enabled_patterns_by_type: {
        task_sop: ids.taskSop,
      },
    },
  };

  const stagePatterns: Record<CareerCaseStage, Record<string, Pattern>> = {
    stage1: {},
    stage2: {},
    stage3: {},
    stage4: {
      [ids.taskSop]: {
        pattern_id: ids.taskSop,
        type: 'task_sop',
        name: content.taskSopName,
        requires_human_review: false,
        instruction: content.taskSopInstruction,
        example: content.taskSopExample,
        review_status: 'approved',
        source_line: {
          from: ids.m1,
          to: ids.p6,
        },
        created_at: timestamp(30),
        updated_at: timestamp(30),
        created_from_project_id: projectId,
      },
    },
  };

  const selectionStateByStage: Record<CareerCaseStage, PresetProjectBundle['selectionState']> = {
    stage1: {
      isNodeSelectionMode: false,
      nodeSelectionIntent: 'batch',
      selectedNodeIds: [],
    },
    stage2: {
      isNodeSelectionMode: true,
      nodeSelectionIntent: 'batch',
      selectedNodeIds: [ids.a1, ids.a2, ids.a3, ids.a4],
    },
    stage3: {
      isNodeSelectionMode: true,
      nodeSelectionIntent: 'delete',
      selectedNodeIds: [ids.t1, ids.t2, ids.t3, ids.t4],
    },
    stage4: {
      isNodeSelectionMode: false,
      nodeSelectionIntent: 'batch',
      selectedNodeIds: [],
    },
  };

  return {
    project: {
      project_id: projectId,
      title,
      root_node_id: ids.m1,
      mainline_id: `mainline_${projectId}`,
      active_context_id: contextId,
    },
    nodes: stageNodes[stage],
    branches: stageBranches[stage],
    mainline: stageMainlines[stage],
    context: stageContexts[stage],
    naturalBranches: stageBranches[stage],
    patterns: stagePatterns[stage],
    selectionState: selectionStateByStage[stage],
  };
};

const exampleBundle = buildTutorialProjectBundle({
  projectId: EXAMPLE_PROJECT_ID,
  contextId: EXAMPLE_CONTEXT_ID,
  prefix: 'ex',
  language: 'en',
});

const exampleNodes = exampleBundle.nodes;
const exampleBranches = exampleBundle.branches;

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
  return deriveParentBranchIdFromGraph(projectId, anchorNodeId, state.nodes, state.branches);
};

const deriveParentBranchIdFromGraph = (
  projectId: string,
  anchorNodeId: string,
  nodesById: Record<string, Node>,
  branchesById: Record<string, Branch>
): string | null => {
  const anchorNode = nodesById[anchorNodeId];
  if (!anchorNode || anchorNode.project_id !== projectId) return null;
  if (!anchorNode.branch_id) return null;
  const anchorBranch = branchesById[anchorNode.branch_id];
  if (!anchorBranch || anchorBranch.project_id !== projectId) return null;
  return anchorBranch.branch_id;
};

const deriveAnchorNodeIdForBranch = (
  projectId: string,
  branchId: string,
  currentAnchorNodeId: string,
  nodesById: Record<string, Node>
): string => {
  const branchNodes = Object.values(nodesById)
    .filter((node) => node.project_id === projectId && node.branch_id === branchId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const firstBranchNode = branchNodes[0];
  if (!firstBranchNode) return currentAnchorNodeId;

  let anchorId = firstBranchNode.parent_id;
  while (anchorId) {
    const anchorNode = nodesById[anchorId];
    if (!anchorNode || anchorNode.project_id !== projectId) break;
    if (anchorNode.branch_id !== branchId) return anchorId;
    anchorId = anchorNode.parent_id;
  }

  return currentAnchorNodeId;
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

const resolveNodeInclusionResolution = (input: {
  projectId: string;
  nodeId: string;
  context: ContextView;
  nodesById: Record<string, Node>;
  branchesById: Record<string, Branch>;
  mainlinesByProject: Record<string, string[]>;
}) => {
  const resolvedMainline = (input.mainlinesByProject[input.projectId] || []).filter(
    (id) => input.nodesById[id]?.project_id === input.projectId
  );
  const naturalVisibleIds = resolveVisibleNodeIdsForBasePath(
    input.projectId,
    input.context.base_path,
    input.branchesById,
    input.nodesById,
    resolvedMainline
  );

  const isExplicitlyIncluded = input.context.included_nodes.includes(input.nodeId);
  const isExplicitlyExcluded = input.context.excluded_nodes.includes(input.nodeId);
  const isNaturallyActive = naturalVisibleIds.has(input.nodeId);
  const isEffectivelyIncluded = (isNaturallyActive && !isExplicitlyExcluded) || isExplicitlyIncluded;

  return {
    isExplicitlyIncluded,
    isExplicitlyExcluded,
    isNaturallyActive,
    isEffectivelyIncluded,
  };
};

const applyNodeInclusionAction = (input: {
  nodeId: string;
  includedNodes: string[];
  excludedNodes: string[];
  resolution: ReturnType<typeof resolveNodeInclusionResolution>;
  action: NodeInclusionAction;
}) => {
  let nextIncluded = input.includedNodes.filter((id) => id !== input.nodeId);
  let nextExcluded = input.excludedNodes.filter((id) => id !== input.nodeId);

  let resolvedAction = input.action;
  if (resolvedAction === 'invert') {
    resolvedAction = input.resolution.isEffectivelyIncluded ? 'exclude' : 'include';
  }

  if (resolvedAction === 'natural') {
    return { includedNodes: nextIncluded, excludedNodes: nextExcluded };
  }

  if (resolvedAction === 'include') {
    if (!input.resolution.isNaturallyActive) {
      nextIncluded.push(input.nodeId);
    }
    return { includedNodes: nextIncluded, excludedNodes: nextExcluded };
  }

  if (input.resolution.isNaturallyActive) {
    nextExcluded.push(input.nodeId);
  }
  return { includedNodes: nextIncluded, excludedNodes: nextExcluded };
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
          ...exampleBundle.project,
        },
      }
    : {},
  nodes: seedExampleData ? exampleNodes : {},
  branches: seedExampleData ? exampleBranches : {},
  mainlines: seedExampleData
    ? {
        [EXAMPLE_PROJECT_ID]: exampleBundle.mainline,
      }
    : {},
  contexts: seedExampleData
    ? {
        [EXAMPLE_CONTEXT_ID]: exampleBundle.context,
      }
    : {},
  patterns: seedExampleData ? exampleBundle.patterns : {},
  pastStructureSnapshots: [],
  futureStructureSnapshots: [],
  naturalMainlines: seedExampleData
    ? {
        [EXAMPLE_PROJECT_ID]: exampleBundle.mainline,
      }
    : {},
  naturalBranches: seedExampleData ? exampleBundle.naturalBranches : {},
  deletedNodeIds: [],
  isNodeSelectionMode: seedExampleData ? exampleBundle.selectionState.isNodeSelectionMode : false,
  nodeSelectionIntent: seedExampleData ? exampleBundle.selectionState.nodeSelectionIntent : 'batch',
  selectedNodeIds: seedExampleData ? exampleBundle.selectionState.selectedNodeIds : [],
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

  importTutorialProject: (language = 'en') => {
    const projectId = uuidv4();
    const contextId = uuidv4();
    const prefix = `tutorial-${projectId.slice(0, 8)}`;
    const bundle = buildTutorialProjectBundle({
      projectId,
      contextId,
      prefix,
      language,
    });

    set((state) => ({
      projects: { ...state.projects, [projectId]: bundle.project },
      nodes: { ...state.nodes, ...bundle.nodes },
      branches: { ...state.branches, ...bundle.branches },
      mainlines: { ...state.mainlines, [projectId]: bundle.mainline },
      contexts: { ...state.contexts, [contextId]: bundle.context },
      patterns: { ...state.patterns, ...bundle.patterns },
      naturalMainlines: { ...state.naturalMainlines, [projectId]: bundle.mainline },
      naturalBranches: { ...state.naturalBranches, ...bundle.naturalBranches },
      isNodeSelectionMode: bundle.selectionState.isNodeSelectionMode,
      nodeSelectionIntent: bundle.selectionState.nodeSelectionIntent,
      selectedNodeIds: bundle.selectionState.selectedNodeIds,
      activeProjectId: projectId,
    }));

    return projectId;
  },

  importCareerCaseProject: (stage = 'stage1', language = 'en') => {
    const projectId = uuidv4();
    const contextId = uuidv4();
    const prefix = `career-case-${projectId.slice(0, 8)}`;
    const bundle = buildCareerCaseProjectBundle({
      projectId,
      contextId,
      prefix,
      stage,
      language,
    });

    set((state) => ({
      projects: { ...state.projects, [projectId]: bundle.project },
      nodes: { ...state.nodes, ...bundle.nodes },
      branches: { ...state.branches, ...bundle.branches },
      mainlines: { ...state.mainlines, [projectId]: bundle.mainline },
      contexts: { ...state.contexts, [contextId]: bundle.context },
      patterns: { ...state.patterns, ...bundle.patterns },
      naturalMainlines: { ...state.naturalMainlines, [projectId]: bundle.mainline },
      naturalBranches: { ...state.naturalBranches, ...bundle.naturalBranches },
      isNodeSelectionMode: bundle.selectionState.isNodeSelectionMode,
      nodeSelectionIntent: bundle.selectionState.nodeSelectionIntent,
      selectedNodeIds: bundle.selectionState.selectedNodeIds,
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

  addNode: (projectId, parentId, role, content, branchId, timestampOverride) => {
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
        timestamp: timestampOverride ?? new Date().toISOString(),
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

  editNodeContent: (nodeId, content) => {
    set((state) => {
      const node = state.nodes[nodeId];
      if (!node) return state;
      if (content === node.content) return state;

      return {
        nodes: {
          ...state.nodes,
          [nodeId]: {
            ...node,
            content,
            metadata: {
              ...node.metadata,
              edited_at: new Date().toISOString(),
            },
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
      const resolution = resolveNodeInclusionResolution({
        projectId,
        nodeId,
        context,
        nodesById: state.nodes,
        branchesById: state.branches,
        mainlinesByProject: state.mainlines,
      });
      const nextAction: NodeInclusionAction =
        resolution.isExplicitlyIncluded || resolution.isExplicitlyExcluded
          ? 'natural'
          : resolution.isNaturallyActive
            ? 'exclude'
            : 'include';
      const { includedNodes, excludedNodes } = applyNodeInclusionAction({
        nodeId,
        includedNodes: context.included_nodes,
        excludedNodes: context.excluded_nodes,
        resolution,
        action: nextAction,
      });

      return {
        contexts: {
          ...state.contexts,
          [context.context_id]: {
            ...context,
            included_nodes: includedNodes,
            excluded_nodes: excludedNodes,
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

  updateBranchCompletionSummary: (branchId, summary) => {
    set((state) => {
      const branch = state.branches[branchId];
      if (!branch) return state;
      return {
        branches: {
          ...state.branches,
          [branchId]: { ...branch, branch_summary: summary },
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
      if (!project) return state;
      const context = state.contexts[project.active_context_id];
      if (!context) return state;
      
      let newIncluded = [...context.included_nodes];
      let newExcluded = [...context.excluded_nodes];

      nodeIds.forEach((nodeId) => {
        const node = state.nodes[nodeId];
        if (!node || node.project_id !== projectId) return;
        const resolution = resolveNodeInclusionResolution({
          projectId,
          nodeId,
          context: {
            ...context,
            included_nodes: newIncluded,
            excluded_nodes: newExcluded,
          },
          nodesById: state.nodes,
          branchesById: state.branches,
          mainlinesByProject: state.mainlines,
        });
        const result = applyNodeInclusionAction({
          nodeId,
          includedNodes: newIncluded,
          excludedNodes: newExcluded,
          resolution,
          action,
        });
        newIncluded = result.includedNodes;
        newExcluded = result.excludedNodes;
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

      Object.values(updatedBranches).forEach((branch) => {
        if (branch.project_id !== projectId) return;
        updatedBranches[branch.branch_id] = {
          ...branch,
          anchor_node_id: deriveAnchorNodeIdForBranch(
            projectId,
            branch.branch_id,
            branch.anchor_node_id,
            updatedNodes
          ),
        };
      });

      Object.values(updatedBranches).forEach((branch) => {
        if (branch.project_id !== projectId) return;
        const nextParentBranchId = deriveParentBranchIdFromGraph(
          projectId,
          branch.anchor_node_id,
          updatedNodes,
          updatedBranches
        );
        updatedBranches[branch.branch_id] = {
          ...branch,
          parent_branch_id:
            nextParentBranchId && nextParentBranchId !== branch.branch_id ? nextParentBranchId : null,
        };
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

  toggleNodeSelection: (nodeId, additive = true) => {
    set((state) => {
      return {
        selectedNodeIds: resolveNodeSelectionClick(state.selectedNodeIds, nodeId, additive),
      };
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
