# Task Plan: Restore Chat History From Supabase

## Goal
Restore chat history from Supabase back into the local app state so a user can recover conversation nodes/projects on a new browser or device.

## Current Phase
Phase 5

## Phases

### Phase 1: Requirements & Discovery
- [x] Understand current chat-history push-only flow
- [x] Inspect store shape needed for restoration
- [x] Document findings and restoration limits in findings.md
- **Status:** complete

### Phase 2: Planning & Structure
- [x] Define best-effort reconstruction rules from remote messages
- [x] Confirm store merge approach and trigger points
- [x] Document decisions with rationale
- **Status:** complete

### Phase 3: Implementation
- [x] Add failing scripted tests for remote chat-history reconstruction
- [x] Implement remote pull + reconstruction helpers
- [x] Wire pull flow into app startup/user switch
- [x] Expose pull status in manage UI if needed
- **Status:** complete

### Phase 4: Testing & Verification
- [x] Run red -> green scripted tests
- [x] Run typecheck
- [x] Document verification and structural recovery limitations in progress.md
- **Status:** complete

### Phase 5: Delivery
- [x] Review touched files
- [x] Summarize what recovery now covers vs cannot cover from current schema
- [x] Deliver user-facing setup notes
- **Status:** complete

## Key Questions
1. What minimum store shape can be reconstructed from `chat_history` alone?
2. Which parts of the current Context Map are unrecoverable without additional remote fields?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Reconstruct best-effort projects/nodes/mainlines/branches from remote messages | `chat_history` lacks enough data for exact replay of later structure mutations, but it does contain enough to recover a usable conversation tree. |
| Merge remote nodes by `message_id` and preserve existing local nodes when already present | Local Zustand state remains the primary source when present; remote pull fills gaps and bootstraps empty browsers. |
| Default restored active context to mainline per project | There is no remote context-view snapshot today, so the safest recoverable default is mainline. |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| None yet | 1 | N/A |

## Notes
- Re-read this plan before changing merge semantics.
- Be explicit in the final summary about recovery limits imposed by the current remote schema.
