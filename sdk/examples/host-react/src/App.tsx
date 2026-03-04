import { useMemo } from 'react';
import { ContextMapEngine } from '@context-map/core';
import { createConsoleEventBus, createMemoryStorageAdapter } from '@context-map/adapters';
import { ContextMapPanel, ContextMapProvider } from '@context-map/react';

export default function App() {
  const engine = useMemo(() => {
    const instance = new ContextMapEngine({
      storage: createMemoryStorageAdapter(),
      events: createConsoleEventBus('[host-react]'),
    });

    const projectId = instance.createProject('SDK Embedded Demo');
    const n1 = instance.addNode({
      projectId,
      parentId: null,
      role: 'user',
      content: 'Design a reusable SDK strategy',
      branchId: null,
    });

    instance.addNode({
      projectId,
      parentId: n1,
      role: 'assistant',
      content: 'Break it into core, react, and adapter layers.',
      branchId: null,
    });

    return instance;
  }, []);

  return (
    <main className="shell">
      <div className="card">
        <h1>Context Map Host React Example</h1>
        <p>Minimal host app that embeds the SDK panel.</p>
        <ContextMapProvider engine={engine}>
          <ContextMapPanel />
        </ContextMapProvider>
      </div>
    </main>
  );
}
