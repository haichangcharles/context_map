# Findings & Decisions

## Requirements
- Sync `pattern` data to Supabase in addition to existing browser-local persistence.
- Keep current per-user local behavior intact.
- Produce concrete table/schema guidance for the remote side.

## Research Findings
- App state, including `patterns`, is persisted only through Zustand `persist` into user-scoped browser `localStorage` keys in `src/store.ts`.
- Chat messages already use a separate local-first sync service in `src/services/chatHistory.ts`: write to `localStorage`, queue pending records, then POST batches to Supabase when env/network is available.
- `createPattern`, `updatePattern`, `approvePattern`, and `deletePattern` are centralized in `src/store.ts`, so they are the cleanest integration points for remote sync.
- The manage page already exposes chat sync status but not any pattern sync state.
- The repo has no Vitest/Jest harness; scripted `tsx` tests are the established lightweight testing path.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Add a dedicated `patternHistory`/pattern sync service instead of overloading Zustand persistence | The remote sync needs queue state, retry behavior, and Supabase mapping separate from local store hydration. |
| Store pattern records remotely as the latest snapshot plus `is_deleted` | Upsert-friendly design keeps reads simple and supports delete propagation. |
| Reuse the existing Supabase env vars and retry triggers (`online`, visibility, interval) | Consistent operational behavior reduces surprise and avoids duplicate config. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| `superpowers:test-driven-development` expects tests-first, but the repo lacks a standard unit test runner | Use the existing `tsx` script-based testing style and run the new script red -> green. |

## Resources
- `/Users/charles/Downloads/context_map/src/store.ts`
- `/Users/charles/Downloads/context_map/src/services/chatHistory.ts`
- `/Users/charles/Downloads/context_map/src/components/ManagePanel.tsx`
- `/Users/charles/Downloads/context_map/src/components/ContextMap.tsx`

## Sync/Data Findings
- Chat sync uses `context-map.chat-history.by-user.v1`, `context-map.chat-history.pending-sync.v1`, and `context-map.chat-history.sync-status.v1` in `localStorage`.
- Supabase sync is optional; if env vars are absent, local behavior still works.
- The active user id is already available from `branchFeedbackDataset`, so pattern sync can share the same user identity source.
