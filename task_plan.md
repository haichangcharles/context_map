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

## Follow-up: Restored Project Titles

### Goal
Ensure recovered projects use their stored title instead of fallback labels like `Recovered c144d8c` whenever remote chat-history data contains the title.

### Phases
- [x] Trace the restored-title data flow and confirm root cause
- [x] Add a failing regression test for recovered project titles
- [x] Update sync + reconstruction logic and verify

### Root Cause
- `src/services/chatHistory.ts` reconstructed every project title via `Recovered ${projectId.slice(0, 8)}`.
- The remote `chat_history` payload did not previously include a `project_title` field, so exact titles were unrecoverable from remote-only state.

### Fix Summary
- Added optional `project_title` to chat-history records.
- Recovery now prefers the latest non-empty stored `project_title` per project and falls back only for legacy rows.
- Sync now attaches `project.title` when logging new nodes.
- Upsert now auto-retries without `project_title` if the Supabase table has not been migrated yet.

## Follow-up: Delete Selected Nodes From Map

### Goal
Replace the current `Fit` affordance with a high-risk delete workflow that reuses selection mode, previews the structural outcome, requires explicit confirmation, preserves descendants when deleting middle segments, and supports undo of the last delete.

### Phases
- [x] Trace current selection UI and structural history hooks
- [x] Add failing scripted tests for delete semantics
- [x] Implement store-level delete mutation and preview helper
- [x] Replace fit UI with delete mode, preview, and confirmation
- [x] Verify scripted tests and typecheck

### Constraints
- Deleting a tail segment or an entire thread should remove it normally.
- Deleting a middle segment should splice the remaining graph back together.
- If the deleted range includes a branch anchor or other splice point, insert a placeholder node so surviving descendants stay connected without rewriting meaning.
- The action must be confirm-only and reversible through the existing structure undo stack.

## Follow-up: Delete Project Crash

### Goal
Prevent the app from crashing with React error `#300` after deleting the currently active project.

### Phases
- [x] Reproduce from the reported delete-project flow and inspect the runtime error class
- [x] Trace the hook/render path in project-dependent React components
- [x] Apply the minimal hook-order-safe fix in the affected component
- [x] Verify with typecheck/build and document the root cause

### Root Cause
- `src/components/ConversationStream.tsx` returned early when `project`/`context` became null after `deleteProject`.
- That early return happened before later `useEffect` hooks in the same component, so deleting the active project changed the number of hooks executed in that render.
- React surfaces that invariant violation as minified error `#300` in production.

## Follow-up: Deleted Project Reappears

### Goal
Ensure deleting a project is durable locally and not undone by the next remote chat-history pull.

### Phases
- [x] Trace delete-project state changes and remote merge path
- [x] Add a failing regression test for project deletion + stale remote merge
- [x] Preserve project node tombstones on delete and sync them remotely
- [x] Filter out fully deleted remote projects during merge and verify

### Root Cause
- `deleteProject` removed project state locally but discarded the deleted node IDs for that project.
- The next `pullRemoteChatHistory()` still returned the project's historical messages, and `mergeRecoveredChatStateIntoStore()` had no local tombstones to suppress them.
- Even after node filtering, `filterRecoveredChatStateByDeletedNodeIds` still preserved empty project shells, so a deleted project title could reappear with no nodes.
