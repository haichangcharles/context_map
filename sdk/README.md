# Context Map SDK

A publishable SDK workspace that turns Context Map into an embeddable capability layer for third-party apps.

## Packages

- `@context-map/core`
  - Headless engine for projects, nodes, branches, and context orchestration
- `@context-map/react`
  - React embedding layer (`Provider`, hooks, and base panel)
- `@context-map/adapters`
  - Default adapters (memory storage and event bus templates)

## Local Development

```bash
cd sdk
npm install
npm run verify
```

`verify` runs typecheck, tests, build, and package dry-run.

## Publish Checklist

1. Confirm package versions in `packages/*/package.json`
2. Run `npm run verify`
3. Login to npm: `npm login`
4. Publish in dependency order:

```bash
npm publish --workspace @context-map/core --access public
npm publish --workspace @context-map/adapters --access public
npm publish --workspace @context-map/react --access public
```

## Compatibility

- Node.js 20+
- React 18+ (for `@context-map/react` only)

## Notes

- This folder is an independent workspace and can evolve separately from the app shell.
- Integrators should start with `@context-map/core`, then add React/UI bindings as needed.
