# Task Plan: Sync Patterns To Supabase

## Goal
Persist pattern records beyond browser-only storage by logging pattern CRUD changes locally and syncing them to Supabase, mirroring the existing chat-history flow.

## Current Phase
Phase 5

## Phases

### Phase 1: Requirements & Discovery
- [x] Understand current pattern persistence and sync constraints
- [x] Inspect existing chat-history sync flow and current tests
- [x] Document findings in findings.md
- **Status:** complete

### Phase 2: Planning & Structure
- [x] Define minimal sync architecture for pattern CRUD
- [x] Confirm target files and required status surfaces
- [x] Document decisions with rationale
- **Status:** complete

### Phase 3: Implementation
- [x] Add failing tests for pattern sync service
- [x] Implement local queue + Supabase sync for patterns
- [x] Wire store CRUD actions into the sync service
- [x] Expose pattern sync status in manage UI if needed
- **Status:** complete

### Phase 4: Testing & Verification
- [x] Run new targeted tests red -> green
- [x] Run typecheck
- [x] Document verification and remaining risks in progress.md
- **Status:** complete

### Phase 5: Delivery
- [x] Review touched files
- [x] Summarize code changes and Supabase schema updates
- [x] Deliver user-facing setup notes
- **Status:** complete

## Key Questions
1. Should pattern sync mirror chat-history behavior by writing locally first and retrying async to Supabase?
2. Do we need full snapshot upserts or event logs for deletes as well?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Reuse the chat-history sync shape for patterns | The project already has local-first + queued Supabase upsert behavior, so a second bespoke sync path would add unnecessary divergence. |
| Treat pattern sync as snapshot upserts with a soft-delete flag | This lets Supabase reflect deletes without requiring a separate tombstone table. |
| Keep app-state persistence in Zustand localStorage and add a separate pattern sync service | This minimizes risk to existing hydration logic while still providing remote durability. |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| None yet | 1 | N/A |

## Notes
- Re-read this plan before changing store persistence or sync semantics.
- Keep the first implementation narrowly scoped to patterns, not all app state.
