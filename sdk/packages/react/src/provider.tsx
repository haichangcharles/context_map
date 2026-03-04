import React, { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import type { ContextMapEngine, ContextMapState } from '@context-map/core';
import type { ContextMapProviderProps } from './types';

const ContextMapEngineContext = createContext<ContextMapEngine | null>(null);

export function ContextMapProvider({ engine, children }: ContextMapProviderProps) {
  const value = useMemo(() => engine, [engine]);
  return <ContextMapEngineContext.Provider value={value}>{children}</ContextMapEngineContext.Provider>;
}

export function useContextMapEngine(): ContextMapEngine {
  const engine = useContext(ContextMapEngineContext);
  if (!engine) {
    throw new Error('useContextMapEngine must be used inside ContextMapProvider');
  }
  return engine;
}

export function useContextMapState(): ContextMapState {
  const engine = useContextMapEngine();
  return useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.getSnapshot(),
    () => engine.getSnapshot()
  );
}
