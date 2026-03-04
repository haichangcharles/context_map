# @context-map/core

Framework-agnostic engine for Context Map.

## Features

- Project/node/branch/context data model
- Mainline + branch operations
- Include/exclude context controls
- Host adapter contracts (storage + event bus + model provider)

## Install

```bash
npm i @context-map/core
```

## Quick Start

```ts
import { ContextMapEngine } from '@context-map/core';

const engine = new ContextMapEngine();
const projectId = engine.createProject('Demo');

const n1 = engine.addNode({
  projectId,
  parentId: null,
  role: 'user',
  content: 'Plan my release',
  branchId: null,
});

engine.createBranch(projectId, n1);
```
