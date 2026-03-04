# @context-map/react

React embedding kit for Context Map.

## Install

```bash
npm i @context-map/react @context-map/core
```

## Example

```tsx
import { ContextMapEngine } from '@context-map/core';
import { ContextMapProvider, ContextMapPanel } from '@context-map/react';

const engine = new ContextMapEngine();

export function App() {
  return (
    <ContextMapProvider engine={engine}>
      <ContextMapPanel />
    </ContextMapProvider>
  );
}
```
