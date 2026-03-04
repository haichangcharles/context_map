import type { ContextMapState, Node, Pattern } from './types';

export interface ModelProvider {
  generateResponse(input: {
    systemPrompt: string;
    contextNodes: Node[];
    userMessage: string;
    activePattern: Pattern | null;
    activeStepIndex?: number;
  }): Promise<string>;
}

export interface StorageAdapter {
  loadState(): Promise<ContextMapState | null>;
  saveState(state: ContextMapState): Promise<void>;
}

export type ContextMapEvent =
  | { type: 'project.created'; projectId: string; title: string }
  | { type: 'project.deleted'; projectId: string }
  | { type: 'project.active.changed'; projectId: string }
  | { type: 'node.added'; projectId: string; nodeId: string }
  | { type: 'node.updated'; nodeId: string }
  | { type: 'branch.created'; projectId: string; branchId: string; anchorNodeId: string }
  | { type: 'branch.promoted'; projectId: string; branchId: string }
  | { type: 'context.changed'; projectId: string; contextId: string };

export interface EventBus {
  emit(event: ContextMapEvent): void;
}
