import type { ContextMapEvent, EventBus } from '@context-map/core';

export function createConsoleEventBus(prefix = '[context-map]'): EventBus {
  return {
    emit(event: ContextMapEvent) {
      // eslint-disable-next-line no-console
      console.log(prefix, event.type, event);
    },
  };
}

export function createNoopEventBus(): EventBus {
  return {
    emit() {
      // no-op
    },
  };
}
