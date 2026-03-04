# Host React Example

Minimal React host integration example for embedding the Context Map SDK.

## Run

```bash
cd sdk/examples/host-react
npm install
npm run dev
```

Open: `http://localhost:4173`

## What this example demonstrates

- Create an engine with `@context-map/core`
- Inject memory storage and console event bus from `@context-map/adapters`
- Embed with `ContextMapProvider` and `ContextMapPanel` from `@context-map/react`
