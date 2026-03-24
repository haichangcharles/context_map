export type ModelProviderPreference = 'auto' | 'siliconflow' | 'openai';

const PROVIDER_KEY = 'context-map.model-provider.preference';
const OPENAI_MODEL_KEY = 'context-map.model-provider.openai-model';

export const getModelProviderPreference = (): ModelProviderPreference => {
  if (typeof window === 'undefined') return 'openai';
  const raw = (window.localStorage.getItem(PROVIDER_KEY) || '').trim();
  if (raw === 'siliconflow' || raw === 'openai' || raw === 'auto') return raw;
  return 'openai';
};

export const setModelProviderPreference = (value: ModelProviderPreference) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PROVIDER_KEY, value);
};

export const getOpenAIModelOverride = (): string => {
  if (typeof window === 'undefined') return '';
  return (window.localStorage.getItem(OPENAI_MODEL_KEY) || '').trim();
};

export const setOpenAIModelOverride = (value: string) => {
  if (typeof window === 'undefined') return;
  const normalized = value.trim();
  if (!normalized) {
    window.localStorage.removeItem(OPENAI_MODEL_KEY);
    return;
  }
  window.localStorage.setItem(OPENAI_MODEL_KEY, normalized);
};
