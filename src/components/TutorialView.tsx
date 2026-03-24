import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { BookOpen, ChevronRight, Home, Sparkles, UserRound } from 'lucide-react';
import { PatternType } from '../types';
import BranchStatusBar from './shared/BranchStatusBar';
import ContextMapModeStrip from './shared/ContextMapModeStrip';
import ContextMapSelectionActionBar from './shared/ContextMapSelectionActionBar';
import ConversationNodeHoverActions from './shared/ConversationNodeHoverActions';

type TutorialPathway = 'manual' | 'chat' | 'suggested';
type GovernanceNodeState = 'active' | 'included' | 'excluded';

type GovernanceNode = {
  id: string;
  label: string;
  state: GovernanceNodeState;
  detail: string;
};

const articleSurface =
  'rounded-[2rem] border border-zinc-200/80 bg-white/92 shadow-[0_30px_90px_rgba(15,23,42,0.08)] backdrop-blur-xl';
const demoSurface =
  'rounded-[1.6rem] border border-zinc-200/90 bg-white shadow-[0_18px_42px_rgba(15,23,42,0.08)]';

const initialGovernanceNodes: GovernanceNode[] = [
  {
    id: 'node-a',
    label: '主问题',
    state: 'active',
    detail: '用户正在推进 tutorial 的主任务。',
  },
  {
    id: 'node-b',
    label: '旁支比较',
    state: 'included',
    detail: '这条比较仍然有参考价值，所以被显式纳入 context。',
  },
  {
    id: 'node-c',
    label: '旧尝试',
    state: 'excluded',
    detail: '这条旧路径已经不再参与当前推理。',
  },
];

const pathways: Record<TutorialPathway, string> = {
  manual: '手动路径：你直接点界面上的控件。它最显式，最适合你已经知道自己想怎么组织结构的时候。',
  chat: '对话路径：你在聊天里自然表达意图，比如“把这个开成 branch”或“帮我把这段整理成 SOP”。系统会尝试把语言意图转成结构动作。',
  suggested:
    '模型建议路径：当系统积累了足够交互、并且对你的偏好和当前意图有更高把握时，它会比较保守地提出 branch、return 或 extract suggestion。',
};

function ArticleSection({
  id,
  step,
  title,
  subtitle,
  children,
}: {
  id: string;
  step: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-zinc-200/80 px-7 py-8 first:border-t-0 md:px-10 md:py-10">
      <div className="max-w-3xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-zinc-500">{step}</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">{title}</h2>
        {subtitle && <p className="mt-3 max-w-2xl text-[15px] leading-7 text-zinc-600">{subtitle}</p>}
      </div>
      <div className="mt-6 space-y-5 text-[15px] leading-8 text-zinc-700">{children}</div>
    </section>
  );
}

function DemoCallout({
  title,
  text,
  tone = 'neutral',
}: {
  title: string;
  text: string;
  tone?: 'neutral' | 'accent';
}) {
  return (
    <div
      className={clsx(
        'rounded-[1.2rem] border px-4 py-4 text-sm leading-6',
        tone === 'accent'
          ? 'border-sky-200 bg-sky-50/90 text-sky-900'
          : 'border-zinc-200 bg-zinc-50 text-zinc-700'
      )}
    >
      <p className="font-medium text-zinc-950">{title}</p>
      <p className="mt-2">{text}</p>
    </div>
  );
}

function TinyMapNode({
  node,
  isSelected,
  onToggle,
}: {
  node: GovernanceNode;
  isSelected: boolean;
  onToggle: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        'group relative rounded-[1.3rem] border px-4 py-4 text-left transition duration-150',
        isSelected
          ? 'border-sky-400 bg-sky-50 shadow-[0_18px_36px_rgba(14,165,233,0.14)]'
          : node.state === 'excluded'
            ? 'border-rose-200 bg-rose-50/80'
            : node.state === 'included'
              ? 'border-emerald-200 bg-emerald-50/80'
              : 'border-indigo-200 bg-indigo-50/80'
      )}
    >
      <div className="absolute -top-2 left-4 rounded-full border border-white/80 bg-white/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 shadow-sm">
        {node.state}
      </div>
      <p className="mt-2 text-sm font-semibold text-zinc-950">{node.label}</p>
      <p className="mt-2 text-xs leading-5 text-zinc-600">{node.detail}</p>
      <p className="mt-3 text-[11px] font-medium text-zinc-500 group-hover:text-zinc-700">
        {isSelected ? '已选中。再点一次取消。' : '点击选择；按住 Shift 可以继续多选。'}
      </p>
    </button>
  );
}

export default function TutorialView() {
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [userName, setUserName] = useState('charles-study');
  const [messageActionViewed, setMessageActionViewed] = useState<'branch' | 'context' | 'edit' | null>(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const [nestedBranchOpen, setNestedBranchOpen] = useState(false);
  const [branchPathwayView, setBranchPathwayView] = useState<TutorialPathway>('manual');
  const [toolbarMode, setToolbarMode] = useState<'search' | 'select' | 'delete' | null>(null);
  const [governanceNodes, setGovernanceNodes] = useState(initialGovernanceNodes);
  const [selectedGovernanceIds, setSelectedGovernanceIds] = useState<string[]>([]);
  const [showDeletePreview, setShowDeletePreview] = useState(false);
  const [patternType, setPatternType] = useState<PatternType>('reasoning');
  const [patternPathwayView, setPatternPathwayView] = useState<TutorialPathway>('manual');
  const [mixedMode, setMixedMode] = useState<'branch' | 'return' | 'extract'>('branch');

  const progress = [
    workspaceReady,
    messageActionViewed !== null,
    branchOpen,
    selectedGovernanceIds.length > 0,
    patternPathwayView === 'suggested',
    mixedMode === 'extract',
  ].filter(Boolean).length;

  const selectedCount = selectedGovernanceIds.length;
  const currentPatternLabel = useMemo(() => {
    if (patternType === 'task_sop') return 'Task SOP';
    if (patternType === 'context_case') return 'Context Case';
    return 'Reasoning';
  }, [patternType]);

  const toggleGovernanceSelection = (nodeId: string, additive: boolean) => {
    setShowDeletePreview(false);
    setSelectedGovernanceIds((current) => {
      if (additive) {
        return current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId];
      }
      return current.includes(nodeId) && current.length === 1 ? [] : [nodeId];
    });
  };

  const applyGovernanceAction = (action: 'include' | 'exclude' | 'invert') => {
    setGovernanceNodes((current) =>
      current.map((node) => {
        if (!selectedGovernanceIds.includes(node.id)) return node;
        if (action === 'include') return { ...node, state: 'included' };
        if (action === 'exclude') return { ...node, state: 'excluded' };
        if (node.state === 'included') return { ...node, state: 'excluded' };
        if (node.state === 'excluded') return { ...node, state: 'included' };
        return { ...node, state: 'included' };
      })
    );
  };

  const selectedSummary =
    toolbarMode === 'delete'
      ? '你已经进入 Delete Mode。现在的浮栏不会直接删除内容，而是先要求你预览删除结果。'
      : toolbarMode === 'select' && selectedCount === 0
        ? '你已经进入 Selection Mode，但系统还在等待你点击节点；这就是为什么现在看起来“还没有反应”。'
        : selectedCount > 0
          ? '现在已经有明确的 selection set，所以 include、exclude、extract 或 delete preview 的浮栏才会出现。'
          : '先切换模式，再选中节点；浮栏不会在空状态下出现。';

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(2,132,199,0.14),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(5,150,105,0.12),_transparent_24%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_46%,#f8fafc_100%)] px-4 py-6 text-zinc-900 md:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex items-center justify-between gap-3">
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
          >
            <Home size={15} />
            返回主应用
          </a>
          <div className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-medium uppercase tracking-[0.22em] text-zinc-500">
            Tutorial View
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <article className={articleSurface}>
            <div className="px-7 py-8 md:px-10 md:py-10">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem]">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-zinc-500">Context Map Tutorial</p>
                  <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-950 md:text-5xl">
                    像一篇可以阅读的教程文章
                  </h1>
                  <p className="mt-5 max-w-3xl text-lg leading-8 text-zinc-600">
                    这不是一块独立的教学控制台，而是一篇按用户旅程展开的中文教程。你会顺着阅读往下走，在合适的位置看到系统真实会用到的组件，并理解按钮、状态变化和结构变化分别代表什么。
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3 text-sm text-zinc-600">
                    <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2">
                      <BookOpen size={15} />
                      先读文本，再看组件
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2">
                      <Sparkles size={15} />
                      组件来自真实系统
                    </div>
                  </div>
                </div>
                <div className="rounded-[1.5rem] border border-zinc-200 bg-white px-5 py-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">阅读进度</p>
                  <p className="mt-2 text-3xl font-semibold text-zinc-950">{progress}/6</p>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#111827,#0ea5e9,#14b8a6)] transition-all"
                      style={{ width: `${(progress / 6) * 100}%` }}
                    />
                  </div>
                  <p className="mt-4 text-xs leading-6 text-zinc-500">
                    用户旅程不是按钮目录。先理解用户现在在做什么，再理解这个阶段为什么会出现这些组件。
                  </p>
                </div>
              </div>
            </div>

            <ArticleSection
              id="workspace"
              step="Step 1"
              title="先进入一个有作用域的工作空间"
              subtitle="用户进入系统时，首先建立的是用户和 project 的归属关系，而不是直接向模型丢一句 prompt。"
            >
              <p>
                这里先建立的心智模型是：Context Map 不是无状态聊天。它从用户作用域和 project 容器开始。这样用户后面做的 branch、pattern、context inclusion/exclusion，才有明确的归属位置。
              </p>
              <div className={demoSurface + ' p-5'}>
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-900 text-white">
                    <UserRound size={18} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-zinc-950">工作空间入口</h3>
                    <p className="text-sm text-zinc-600">先绑定用户，再绑定当前 project，后续结构都在这个范围内发生。</p>
                  </div>
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-[1.2fr,0.8fr]">
                  <div className="rounded-[1.25rem] border border-zinc-200 bg-white p-4">
                    <label className="text-sm font-medium text-zinc-700">Tutorial 用户名</label>
                    <input
                      value={userName}
                      onChange={(event) => setUserName(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
                    />
                    <button
                      type="button"
                      onClick={() => setWorkspaceReady(true)}
                      className="mt-3 inline-flex items-center gap-2 rounded-full bg-zinc-950 px-4 py-2 text-sm text-white"
                    >
                      进入 Tutorial Workspace
                    </button>
                  </div>
                  <DemoCallout
                    title="用户在这里应该理解什么"
                    text="这里输入的不是装饰性的昵称。它对应的是当前用户身份，以及后续本地状态和个性化判断的归属。"
                  />
                </div>
              </div>
              {workspaceReady && (
                <DemoCallout
                  title="进入后的预期反馈"
                  text="现在用户应该意识到：自己进入的是一个结构化工作空间，而不是一个每次都从零开始的聊天窗口。"
                  tone="accent"
                />
              )}
            </ArticleSection>

            <ArticleSection
              id="mainline"
              step="Step 2"
              title="先像普通聊天一样，从主线开始"
              subtitle="系统故意先让用户感觉熟悉，再逐步暴露结构能力。"
            >
              <p>
                对多数用户来说，第一步仍然应该像普通聊天一样开始。这不是妥协，而是一种引导。只有当用户真的遇到“我想保留旁支”“我想控制上下文”“我想回到主线”这类问题时，结构能力才应该被引入。
              </p>
              <div className={demoSurface + ' p-5'}>
                <div className="space-y-3">
                  {[
                    ['用户', '我想做一个帮助新用户理解 Context Map 的 tutorial。'],
                    ['助手', '可以先沿着主线开始，等到出现旁支探索时，再显式展示 branch 和 context control。'],
                    ['用户', '所以一开始看起来像普通聊天，对吗？'],
                    ['助手', '对，但这些消息之后都可以变成节点，被 branch、编辑或纳入/排除当前上下文。'],
                  ].map(([role, text], index) => (
                    <div
                      key={`${role}-${index}`}
                      className={clsx(
                        'max-w-[42rem] rounded-[1.4rem] border px-4 py-3 text-sm',
                        role === '用户'
                          ? 'ml-auto border-zinc-900 bg-zinc-900 text-white'
                          : 'border-zinc-200 bg-white text-zinc-800'
                      )}
                    >
                      <p className={clsx('mb-1 text-[11px] font-semibold uppercase tracking-[0.18em]', role === '用户' ? 'text-white/65' : 'text-zinc-500')}>
                        {role}
                      </p>
                      <p className="leading-6">{text}</p>
                    </div>
                  ))}
                </div>
              </div>
              <DemoCallout
                title="这一步想建立的心智模型"
                text="主线不是和结构无关的普通聊天，而是默认工作路径。后面的 branch 和地图操作，都是围绕这条主线展开的。"
              />
            </ArticleSection>

            <ArticleSection
              id="message-actions"
              step="Step 3"
              title="当你聚焦一条消息时，它会变成操作入口"
              subtitle="这一段不只是介绍按钮名，而是用一个真实的 Q/A 场景来解释这些按钮为什么会出现。"
            >
              <p>
                一条消息不是只能继续往下读。它也可以成为结构操作的入口。为了让这个点更具体，下面不是抽象描述，而是一个小的 Q/A 场景。你可以把它理解成用户正在主线上推进任务，但突然想探索一个额外问题。
              </p>
              <div className={demoSurface + ' p-5'}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">一个真实的 Q / A 示例</p>
                <div className="mt-3 rounded-[1.3rem] border border-zinc-200 bg-zinc-50 p-4">
                  <div className="rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-3 text-sm text-white">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/65">用户</p>
                    <p>我们要不要顺便比较一下 tutorial 和 onboarding tour 的区别？</p>
                  </div>
                  <div className="mt-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">助手</p>
                    <p>可以，但这已经有点偏离当前主问题了，所以更适合从这条消息开一个 branch 来继续比较。</p>
                  </div>
                </div>
                <div className="mt-4 rounded-[1.2rem] border border-zinc-200 bg-white px-4 py-3">
                  <p className="text-sm text-zinc-600">把鼠标移到这条消息上方时，系统会暴露出真实的 hover actions：</p>
                  <div className="group mt-4 flex items-center gap-4 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3">
                    <ConversationNodeHoverActions
                      isSelectionActive={false}
                      isExcluded={false}
                      onBranch={() => setMessageActionViewed('branch')}
                      onToggleContext={() => setMessageActionViewed('context')}
                      onEdit={() => setMessageActionViewed('edit')}
                    />
                  </div>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <DemoCallout
                  title="Branch"
                  text="从这条消息开出一条新的结构路径。适合你想保留 side exploration，但不想让它继续污染当前主线的时候。"
                />
                <DemoCallout
                  title="Context"
                  text="切换这条消息对当前上下文的作用。它不是继续对话，而是在改“这条内容算不算当前 context 的一部分”。"
                />
                <DemoCallout
                  title="Edit"
                  text="修改消息本身，而不是围绕它继续提问。它教会用户：消息节点不是只读记录，而是可以被修订的对象。"
                />
              </div>
              {messageActionViewed && (
                <DemoCallout
                  title="点下去之后会发生什么"
                  text={
                    messageActionViewed === 'branch'
                      ? '点 Branch 后，用户不会继续停留在原主线上追加文本，而是会从当前消息生成一条新的 branch path。'
                      : messageActionViewed === 'context'
                        ? '点 Context 后，用户要理解变化的是“是否参与当前上下文”，而不是消息内容本身。'
                        : '点 Edit 后，消息会进入可编辑状态；它影响的是这条消息本身，而不是一条新的后续消息。'
                  }
                  tone="accent"
                />
              )}
            </ArticleSection>

            <ArticleSection
              id="branching"
              step="Step 4"
              title="Branch 不是终点，它还必须教会用户怎么回来"
              subtitle="用户不仅要学会开 branch，还要学会 Return to Mainline 和 Return to Parent。"
            >
              <p>
                Branch 的价值在于把探索留在局部，而不是让它无限地混进主任务里。所以 tutorial 不能只教“怎么开出 branch”，还要让用户真正看到 branch 之后的返回控件，并理解它们分别对应什么路径变化。
              </p>
              <div className={demoSurface + ' p-5'}>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBranchOpen(true);
                      setNestedBranchOpen(false);
                    }}
                    className="rounded-full bg-indigo-600 px-4 py-2 text-sm text-white"
                  >
                    创建一个 Branch
                  </button>
                  <button
                    type="button"
                    onClick={() => setNestedBranchOpen(true)}
                    disabled={!branchOpen}
                    className="rounded-full border border-zinc-300 px-4 py-2 text-sm text-zinc-700 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    再开一个嵌套 Branch
                  </button>
                </div>
                <div className="mt-5 overflow-hidden rounded-[1.4rem] border border-indigo-100">
                  {branchOpen ? (
                    <BranchStatusBar
                      anchorPreview="我们要不要顺便比较一下 tutorial 和 onboarding tour 的区别？"
                      canReturnParent={nestedBranchOpen}
                      onReturnMainline={() => {
                        setBranchOpen(false);
                        setNestedBranchOpen(false);
                      }}
                      onReturnParent={nestedBranchOpen ? () => setNestedBranchOpen(false) : undefined}
                    />
                  ) : (
                    <div className="px-4 py-4 text-sm text-indigo-900">先创建一个 branch，才能看到真实的 branch 状态栏和返回控件。</div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {(['manual', 'chat', 'suggested'] as TutorialPathway[]).map((pathway) => (
                  <button
                    key={pathway}
                    type="button"
                    onClick={() => setBranchPathwayView(pathway)}
                    className={clsx(
                      'rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition',
                      branchPathwayView === pathway ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white text-zinc-700'
                    )}
                  >
                    {pathway}
                  </button>
                ))}
              </div>
              <DemoCallout title="同一个 branch 意图，也可以有三种触发方式" text={pathways[branchPathwayView]} />
              <div className="grid gap-4 md:grid-cols-2">
                <DemoCallout
                  title="Return to Mainline"
                  text="直接离开当前支线，回到默认主线。适合旁支已经完成，用户要重新回到主任务的时候。"
                />
                <DemoCallout
                  title="Return to Parent"
                  text="只回到上一层 branch，而不是整个主线。适合嵌套探索结束后，先退回上一级局部路径。"
                />
              </div>
            </ArticleSection>

            <ArticleSection
              id="governance"
              step="Step 5"
              title="地图操作要让用户理解状态变化，而不是只记按钮名"
              subtitle="这里最重要的不是某个按钮叫什么，而是它先把系统切到什么模式，系统接下来又在等待什么。"
            >
              <p>
                这一步最容易让用户困惑，因为像 Select 这样的按钮点下去之后，界面不一定会立刻出现大变化。它首先切换的是模式，而不是直接生成结果。只有你真正选中了一个或多个节点之后，浮动操作栏才会被 reveal 出来。
              </p>
              <div className={demoSurface + ' p-5'}>
                <ContextMapModeStrip
                  isSelectionMode={toolbarMode === 'select' || toolbarMode === 'delete'}
                  selectionIntent={toolbarMode === 'delete' ? 'delete' : toolbarMode === 'select' ? 'batch' : null}
                  isSearchActive={toolbarMode === 'search'}
                  onToggleSearch={() => setToolbarMode(toolbarMode === 'search' ? null : 'search')}
                  onToggleSelectionMode={() => {
                    setToolbarMode(toolbarMode === 'select' ? null : 'select');
                    setShowDeletePreview(false);
                  }}
                  onRearrange={() => {}}
                  onToggleDeleteMode={() => {
                    setToolbarMode(toolbarMode === 'delete' ? null : 'delete');
                    setShowDeletePreview(false);
                  }}
                />
                <div className="mt-4 rounded-[1.2rem] border border-zinc-200 bg-zinc-50 px-4 py-4 text-sm text-zinc-700">
                  {selectedSummary}
                </div>

                <div className="mt-4 rounded-[1.3rem] border border-zinc-200 bg-white p-4">
                  <p className="text-sm font-semibold text-zinc-950">一个只有三个节点的小地图</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">
                    这里故意只放三个节点。目的不是模拟全部复杂度，而是先让用户学会一件事：先切模式，再选节点，然后才会出现下一层浮栏。点击一个节点会单选；按住 Shift 再点，可以继续多选。
                  </p>
                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    {governanceNodes.map((node) => (
                      <TinyMapNode
                        key={node.id}
                        node={node}
                        isSelected={selectedGovernanceIds.includes(node.id)}
                        onToggle={(event) => toggleGovernanceSelection(node.id, event.shiftKey)}
                      />
                    ))}
                  </div>
                </div>

                {selectedCount > 0 && (
                  <div className="mt-5">
                    {toolbarMode === 'delete' ? (
                      <ContextMapSelectionActionBar
                        mode="delete"
                        selectedCount={selectedCount}
                        pendingDeletePreview={showDeletePreview}
                        pendingDeleteCount={selectedCount}
                        pendingPlaceholderCount={1}
                        onDeletePreview={() => setShowDeletePreview(true)}
                        onClear={() => {
                          setSelectedGovernanceIds([]);
                          setShowDeletePreview(false);
                        }}
                        onCancelPreview={() => setShowDeletePreview(false)}
                        onConfirmDelete={() => {
                          setGovernanceNodes((current) => current.filter((node) => !selectedGovernanceIds.includes(node.id)));
                          setSelectedGovernanceIds([]);
                          setShowDeletePreview(false);
                        }}
                      />
                    ) : (
                      <ContextMapSelectionActionBar
                        mode="batch"
                        selectedCount={selectedCount}
                        pendingPatternType={patternType}
                        onInclude={() => applyGovernanceAction('include')}
                        onExclude={() => applyGovernanceAction('exclude')}
                        onInvert={() => applyGovernanceAction('invert')}
                        onPatternTypeChange={setPatternType}
                        onExtract={() => setPatternPathwayView('manual')}
                      />
                    )}
                  </div>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <DemoCallout
                  title="为什么点击 Select 后可能看起来没有反应"
                  text="因为系统只是进入了 Selection Mode。它现在在等你去点节点，所以不会在空状态下直接弹出批量操作栏。"
                />
                <DemoCallout
                  title="浮栏里的按钮分别代表什么"
                  text="Include 把选中节点显式纳入当前 context；Exclude 把它们排出当前推理范围；Delete 会先进入预览；下拉菜单决定你要提取成 Reasoning、Task SOP 还是 Context Case。"
                />
              </div>
            </ArticleSection>

            <ArticleSection
              id="patterns"
              step="Step 6"
              title="提取模式不是一个按钮，而是三种发起路径"
              subtitle="用户需要知道：提取模式可以在地图上发生，也可以在聊天里说出来，还可以在模型有足够把握时由系统建议。"
            >
              <p>
                如果 tutorial 只把 pattern extraction 讲成一个地图上的按钮，用户会误以为它只能手动操作。更准确的说法是：同一个结构意图可以有多种发起路径。手动路径适合精确控制，对话路径适合自然工作流，而 suggestion 路径则属于系统在保守前提下给出的 mixed-initiative 帮助。
              </p>
              <div className="flex flex-wrap gap-2">
                {(['manual', 'chat', 'suggested'] as TutorialPathway[]).map((pathway) => (
                  <button
                    key={pathway}
                    type="button"
                    onClick={() => setPatternPathwayView(pathway)}
                    className={clsx(
                      'rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition',
                      patternPathwayView === pathway ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white text-zinc-700'
                    )}
                  >
                    {pathway}
                  </button>
                ))}
              </div>
              <div className={demoSurface + ' p-5'}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-zinc-950">提取模式示例</h3>
                    <p className="mt-1 text-sm text-zinc-600">当前展示的是同一个提取意图的不同发起路径。</p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm text-zinc-700">
                    <Sparkles size={15} />
                    {currentPatternLabel}
                  </div>
                </div>
                <div className="mt-4 rounded-[1.2rem] border border-zinc-200 bg-zinc-50 px-4 py-4 text-sm leading-7 text-zinc-700">
                  {pathways[patternPathwayView]}
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <DemoCallout title="地图上手动提取" text="选中节点后，直接在浮栏里选择 pattern 类型并点击 Extract。" />
                  <DemoCallout title="聊天里自然表达" text="用户可以直接说“把这段整理成一个 SOP”或“把这套 reasoning 保存下来”。" />
                  <DemoCallout
                    title="模型保守建议"
                    text="目前 suggestion 设计偏保守。它通常需要更长的交互历史，才能比较有把握地判断你是否真的满意、以及这段内容是否值得沉淀为模式。"
                  />
                </div>
              </div>
            </ArticleSection>

            <ArticleSection
              id="mixed"
              step="Step 7"
              title="把 branch、return、extract 放进同一个 mixed-initiative 框架"
              subtitle="最终要教给用户的，不是一堆分散功能，而是一种统一的结构心智模型。"
            >
              <p>
                Branch、Return 和 Extract 本质上都不是单纯按钮，而是结构意图。用户可以手动点控件，也可以在对话里自然表达，系统在足够有把握时也可以给出建议。tutorial 最后要让用户带走的，就是这套“一个结构意图，多种触发路径”的理解。
              </p>
              <div className="flex flex-wrap gap-2">
                {(['branch', 'return', 'extract'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setMixedMode(mode)}
                    className={clsx(
                      'rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition',
                      mixedMode === mode ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white text-zinc-700'
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <DemoCallout
                  title="手动触发"
                  text={
                    mixedMode === 'branch'
                      ? '直接在消息上点 Branch。'
                      : mixedMode === 'return'
                        ? '直接点 Return to Mainline 或 Return to Parent。'
                        : '直接在地图上选中节点，然后在浮栏里 Extract。'
                  }
                />
                <DemoCallout
                  title="聊天里表达"
                  text={
                    mixedMode === 'branch'
                      ? '例如“这个问题我们另外开一条 branch 看看”。'
                      : mixedMode === 'return'
                        ? '例如“这个支线先收住，我们回到主问题”。'
                        : '例如“把这一段整理成一个可复用的 SOP”。'
                  }
                />
                <DemoCallout
                  title="模型建议"
                  text={
                    mixedMode === 'branch'
                      ? '模型可能会建议把当前旁支开成 branch，以免污染主线。'
                      : mixedMode === 'return'
                        ? '模型可能会在支线探索完成后，建议返回 parent 或 mainline。'
                        : '模型可能会在看见稳定工作模式后，建议提取 reasoning 或 task SOP。'
                  }
                />
              </div>
              <DemoCallout
                title="这一页真正想教会用户的"
                text="你不是只能和 AI 继续对话。你也可以和 AI 一起组织 context：保留旁支、切换路径、控制哪些内容参与当前推理，并把有价值的过程沉淀成以后还能复用的模式。"
                tone="accent"
              />
            </ArticleSection>
          </article>

          <aside className="space-y-4">
            <div className={articleSurface + ' sticky top-6 p-5'}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">阅读目录</p>
              <nav className="mt-4 space-y-2">
                {[
                  ['workspace', '进入工作空间'],
                  ['mainline', '从主线开始'],
                  ['message-actions', '消息上的局部操作'],
                  ['branching', 'Branch 与返回'],
                  ['governance', '地图与选择模式'],
                  ['patterns', '提取模式'],
                  ['mixed', 'Mixed-Initiative'],
                ].map(([id, label]) => (
                  <a
                    key={id}
                    href={`#${id}`}
                    className="flex items-center justify-between rounded-[1rem] border border-transparent bg-white px-3 py-2 text-sm text-zinc-700 transition hover:border-zinc-200 hover:bg-zinc-50"
                  >
                    <span>{label}</span>
                    <ChevronRight size={14} className="text-zinc-400" />
                  </a>
                ))}
              </nav>
              <div className="mt-5 rounded-[1.2rem] border border-zinc-200 bg-zinc-50 px-4 py-4">
                <p className="text-sm font-medium text-zinc-900">阅读顺序提示</p>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  这篇教程不是按钮说明书。先看用户现在处于什么阶段，再看这个阶段为什么会出现这组组件。
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
