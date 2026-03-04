import type React from 'react';
import type { ContextMapEngine, ContextMapState } from '@context-map/core';

export interface ContextMapProviderProps {
  engine: ContextMapEngine;
  children: React.ReactNode;
}

export interface ContextMapPanelProps {
  className?: string;
  state?: ContextMapState;
  onCreateProject?: (title: string) => void;
}
