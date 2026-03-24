export type TutorialPathway = 'manual' | 'chat' | 'suggested';

export type TutorialHighlight = {
  title: string;
  detail: string;
};

export type TutorialStep = {
  id:
    | 'enter-workspace'
    | 'mainline-chat'
    | 'message-actions'
    | 'branching'
    | 'context-governance'
    | 'pattern-extraction'
    | 'mixed-initiative';
  kicker: string;
  title: string;
  journeyGoal: string;
  userQuestion: string;
  actionLabel: string;
  successLabel: string;
  highlights: TutorialHighlight[];
  pathways: TutorialPathway[];
};

export const tutorialSteps: TutorialStep[] = [
  {
    id: 'enter-workspace',
    kicker: 'Step 1',
    title: 'Enter A Structured Workspace',
    journeyGoal: 'Understand that Context Map starts with a user-scoped workspace, not a blank global chat box.',
    userQuestion: 'Where am I working, and why does this system care about users and projects before chat begins?',
    actionLabel: 'Enter a tutorial username and open the guided workspace.',
    successLabel: 'The tutorial workspace is active.',
    highlights: [
      {
        title: 'Username scope',
        detail: 'The system uses a user identity to bind local state, sync state, and future behavior modeling.',
      },
      {
        title: 'Project workspace',
        detail: 'A project is the container for mainlines, branches, context state, and patterns.',
      },
    ],
    pathways: ['manual'],
  },
  {
    id: 'mainline-chat',
    kicker: 'Step 2',
    title: 'Begin On The Mainline',
    journeyGoal: 'Show that the system still begins like a normal conversation before structure becomes necessary.',
    userQuestion: 'If this starts like normal chat, what actually changes later?',
    actionLabel: 'Start the mainline conversation and inspect the default path.',
    successLabel: 'The tutorial mainline is active.',
    highlights: [
      {
        title: 'Mainline path',
        detail: 'The mainline is the default path of work before you branch or restructure context.',
      },
      {
        title: 'Message nodes',
        detail: 'Every user and assistant message is stored as an addressable node, not just rendered text.',
      },
    ],
    pathways: ['manual'],
  },
  {
    id: 'message-actions',
    kicker: 'Step 3',
    title: 'Act On A Message',
    journeyGoal: 'Teach that individual messages become the local entry point for structural operations.',
    userQuestion: 'Can I do something to this exact message instead of only sending the next message?',
    actionLabel: 'Hover a message and inspect its local actions.',
    successLabel: 'The message action affordances are visible.',
    highlights: [
      {
        title: 'Branch Context',
        detail: 'Open a side path from this exact message when you want to explore without polluting the mainline.',
      },
      {
        title: 'Edit',
        detail: 'Revise the current message content when you need to repair or refine the node itself.',
      },
    ],
    pathways: ['manual'],
  },
  {
    id: 'branching',
    kicker: 'Step 4',
    title: 'Branch, Return, And Rejoin',
    journeyGoal: 'Teach how side exploration becomes a branch and how branch navigation differs from returning to the mainline.',
    userQuestion: 'How do I keep a side exploration without letting it take over the main task?',
    actionLabel: 'Create a branch, then practice returning to parent and mainline.',
    successLabel: 'The branch was created and return controls were exercised.',
    highlights: [
      {
        title: 'Return to Mainline',
        detail: 'Leave the current branch and continue the default path again.',
      },
      {
        title: 'Return to Parent',
        detail: 'When you are in a nested branch, go up one structural level instead of all the way back to the mainline.',
      },
      {
        title: 'One intent, multiple paths',
        detail: 'Branching and returning can be manual, requested through conversation, or suggested by the model.',
      },
    ],
    pathways: ['manual', 'chat', 'suggested'],
  },
  {
    id: 'context-governance',
    kicker: 'Step 5',
    title: 'Govern What Counts As Context',
    journeyGoal: 'Make context control concrete: enter modes, select nodes, reveal the action bar, then batch-govern the structure.',
    userQuestion: 'Why did Select seem to do nothing at first, and what exactly appears after I choose nodes?',
    actionLabel: 'Enter selection mode, select nodes, reveal the floating action bar, then try include/exclude/delete flows.',
    successLabel: 'Selection mode, the floating action bar, and delete preview were all exercised.',
    highlights: [
      {
        title: 'Select mode',
        detail: 'Clicking Select changes the interaction mode first. The system is now waiting for node clicks or multi-select gestures.',
      },
      {
        title: 'The floating action bar',
        detail: 'This only appears after at least one node is selected, because the actions operate on a concrete selection set.',
      },
      {
        title: 'Delete preview',
        detail: 'Delete is a guided structural cleanup flow. The system previews impact before anything is removed.',
      },
    ],
    pathways: ['manual'],
  },
  {
    id: 'pattern-extraction',
    kicker: 'Step 6',
    title: 'Extract Reusable Patterns',
    journeyGoal: 'Teach that reusable methods can be captured on the map, requested in chat, or suggested by the model after enough evidence accumulates.',
    userQuestion: 'If I discover a reusable method, how can I keep it for later?',
    actionLabel: 'Explore manual, conversational, and suggested extraction pathways.',
    successLabel: 'All extraction initiation paths were reviewed.',
    highlights: [
      {
        title: 'Map extraction',
        detail: 'Select nodes directly on the structure and extract a Reasoning or Task SOP pattern from them.',
      },
      {
        title: 'Natural-language extraction',
        detail: 'You can simply ask the AI to turn a useful stretch of work into a reusable method.',
      },
      {
        title: 'Conservative suggestions',
        detail: 'Model-triggered extraction is intentionally cautious and becomes more meaningful after enough interaction history exists.',
      },
    ],
    pathways: ['manual', 'chat', 'suggested'],
  },
  {
    id: 'mixed-initiative',
    kicker: 'Step 7',
    title: 'Understand Mixed-Initiative Structure Control',
    journeyGoal: 'Unify branching, returning, and extraction under one mental model: structural intent can be explicit, conversational, or suggested.',
    userQuestion: 'When should I click directly, when can I just say what I want, and when will the system proactively help?',
    actionLabel: 'Compare the three initiation paths across branch, return, and extraction.',
    successLabel: 'The mixed-initiative model is fully reviewed.',
    highlights: [
      {
        title: 'Manual control',
        detail: 'Use the UI directly when you want precise structural control.',
      },
      {
        title: 'Conversational control',
        detail: 'You can express branch, return, and extraction intent in natural language during chat.',
      },
      {
        title: 'Model suggestions',
        detail: 'The model can propose structural actions when the interaction pattern is clear enough to justify a recommendation.',
      },
    ],
    pathways: ['manual', 'chat', 'suggested'],
  },
];
