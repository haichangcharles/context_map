import { Node } from '../types';

export type BehaviourSource = 'manually_branch' | 'ignore_branch' | 'reject_branch' | 'accept_branch';
export type UserBehaviour = 'branch' | 'same_thread';

export type QAPair = {
  user: string;
  assistant: string;
};

export type BranchFeedbackSample = {
  current_tldr: string;
  history_last_3_qa: QAPair[];
  current_node: QAPair;
  user_behaviour: UserBehaviour;
  behaviour_source: BehaviourSource;
  time: string;
};

export type BranchFeedbackDataset = {
  should_branch: BranchFeedbackSample[];
  should_not_branch: BranchFeedbackSample[];
};

type BranchFeedbackByUser = Record<string, BranchFeedbackDataset>;

const STORAGE_KEY = 'context-map.branch-feedback.by-user.v1';
const ACTIVE_USER_KEY = 'context-map.active-user-id';

const emptyDataset = (): BranchFeedbackDataset => ({
  should_branch: [],
  should_not_branch: [],
});

export const readBranchFeedbackDataset = (): BranchFeedbackDataset => {
  const activeUserId = getActiveUserId();
  return readBranchFeedbackDatasetByUser(activeUserId);
};

export const readBranchFeedbackDatasetByUser = (userId: string | null): BranchFeedbackDataset => {
  if (!userId) return emptyDataset();
  if (typeof window === 'undefined') return emptyDataset();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDataset();
    const parsed = JSON.parse(raw) as BranchFeedbackByUser;
    const dataset = parsed[userId];
    if (!dataset) return emptyDataset();
    return {
      should_branch: Array.isArray(dataset.should_branch) ? dataset.should_branch : [],
      should_not_branch: Array.isArray(dataset.should_not_branch) ? dataset.should_not_branch : [],
    };
  } catch {
    return emptyDataset();
  }
};

export const appendBranchFeedbackSample = (sample: BranchFeedbackSample) => {
  if (typeof window === 'undefined') return;
  const activeUserId = getActiveUserId();
  if (!activeUserId) return;
  const dataset = readBranchFeedbackDatasetByUser(activeUserId);
  if (sample.user_behaviour === 'branch') {
    dataset.should_branch.push(sample);
  } else {
    dataset.should_not_branch.push(sample);
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as BranchFeedbackByUser) : {};
    parsed[activeUserId] = dataset;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore storage errors to avoid breaking chat flow.
  }
};

export const getActiveUserId = (): string | null => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(ACTIVE_USER_KEY);
  const normalized = (raw || '').trim();
  return normalized || null;
};

export const setActiveUserId = (userId: string) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACTIVE_USER_KEY, userId.trim());
};

const normalize = (text: string, max = 220): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, max);

export const buildQAPair = (userNode?: Node | null, assistantNode?: Node | null): QAPair => ({
  user: normalize(userNode?.content || ''),
  assistant: normalize(assistantNode?.content || ''),
});
