# Context Map SDK Roadmap

## Goal

Split the current single app into reusable SDK layers that can be embedded into plugins, editors, and enterprise software.

## Phase 0: Scaffold (Complete)

- Create the `sdk/` workspace
- Define `core` / `react` / `adapters` package layers
- Define base domain types and host contracts

## Phase 1: Domain Extraction

- Extract pure domain commands from `src/store.ts` into `@context-map/core`
- Introduce a clean `Command` + `Event` pipeline to reduce direct state mutation
- Keep independent tests for mainline/branch restructuring logic

## Phase 2: Host API Stabilization

- Finalize host integration APIs:
  - project lifecycle
  - conversation lifecycle
  - context include/exclude lifecycle
  - pattern extraction hooks
- Publish early `0.x` versions and collect integration feedback

## Phase 3: Embedding Kits

- Expand React embedding kit
- Add optional Web Component wrapper
- Add a VS Code Webview adapter example
- Add Monaco/CodeMirror examples

## Phase 4: Production Features

- Persistence strategies (snapshots, versioning)
- Multi-model provider compatibility
- Observability (events, performance, cost metrics)

## Recommended Open Source Strategy

1. Publish and maintain `@context-map/core`
2. Publish and maintain `@context-map/react`
3. Maintain official integration examples via adapters
4. Build commercial value on top of enterprise governance (permissions, collaboration, compliance)
