# Findings & Decisions

## Requirements
- User wants a dedicated SDK folder and a concrete plan to convert current app into reusable SDK.
- Output should make it easy for others to repeatedly integrate Context Map into their own products.

## Research Findings
- Current repo already has strong reusable logic in `src/store.ts` and domain model in `src/types.ts`.
- UI and logic are currently coupled through Zustand + React components; this is main extraction boundary.
- SDK scaffold created under `sdk/` with core/react/adapters/docs split.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Define `@context-map/core` first | Core must be UI-agnostic to support plugins/editors/webviews |
| Define `@context-map/react` as optional UI layer | React hosts can embed quickly while non-React hosts still use core |
| Define adapter contracts (`model/storage/event`) | Prevent hard-coding provider-specific behavior |
| Keep first pass as scaffold with minimal in-memory engine | Reduces migration risk while enabling immediate external experimentation |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| `vite.config.ts` had non-ASCII comment artifacts from prior edits | Replaced with ASCII-safe comment |

## Resources
- Existing domain/store: `src/types.ts`, `src/store.ts`
- Existing UI surfaces: `src/components/ConversationStream.tsx`, `src/components/ContextMap.tsx`
- SDK entry docs: `sdk/README.md`, `sdk/docs/sdk-roadmap.md`

## Visual/Browser Findings
- N/A (no visual research required for this task)
