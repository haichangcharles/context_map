# Adapter Template

## Required Interfaces

1. `StorageAdapter`
- Implement `loadState()` and `saveState()`

2. `EventBus`
- Implement `emit(event)` to connect analytics / telemetry

3. `ModelProvider`
- Implement `generateResponse()` to map host model calls

## Host Bootstrap Template

```ts
import { ContextMapEngine } from '@context-map/core';
import { createMemoryStorageAdapter, createConsoleEventBus } from '@context-map/adapters';

const engine = new ContextMapEngine({
  storage: createMemoryStorageAdapter(),
  events: createConsoleEventBus(),
});
```
