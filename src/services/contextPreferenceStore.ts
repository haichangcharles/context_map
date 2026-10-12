import type { ContextChoice } from '../domain/contextSteward';

const CHOICE_KEY = 'context-map.context-return-choices.v1';
const USER_KEY = 'context-map.active-user-id';

export const readContextChoices = (storage: Pick<Storage, 'getItem'>): ContextChoice[] => {
  try {
    const userId = storage.getItem(USER_KEY)?.trim() || 'local-anonymous';
    const data = JSON.parse(storage.getItem(CHOICE_KEY) || '{}') as Record<string, Record<string, ContextChoice[]>>;
    return Object.values(data[userId] || {})
      .flatMap((choices) => Array.isArray(choices) ? choices : [])
      .filter((choice): choice is ContextChoice => Boolean(choice && typeof choice.query === 'string' && (choice.decision === 'accepted' || choice.decision === 'rejected')))
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(-30);
  } catch { return []; }
};

export const recordContextChoice = (storage: Pick<Storage, 'getItem' | 'setItem'>, projectId: string, choice: ContextChoice): void => {
  try {
    const userId = storage.getItem(USER_KEY)?.trim() || 'local-anonymous';
    const data = JSON.parse(storage.getItem(CHOICE_KEY) || '{}') as Record<string, Record<string, ContextChoice[]>>;
    data[userId] ||= {};
    data[userId][projectId] = [...(data[userId][projectId] || []), choice].slice(-30);
    storage.setItem(CHOICE_KEY, JSON.stringify(data));
  } catch { /* Context management remains usable when local storage is unavailable. */ }
};
