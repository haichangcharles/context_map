import type { ContextMapState, StorageAdapter } from '@context-map/core';

export function createMemoryStorageAdapter(initial?: ContextMapState): StorageAdapter {
  let state = initial ? structuredClone(initial) : null;

  return {
    async loadState() {
      return state ? structuredClone(state) : null;
    },
    async saveState(next: ContextMapState) {
      state = structuredClone(next);
    },
  };
}
