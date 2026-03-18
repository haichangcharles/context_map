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

## Follow-up: Sync Branch Feedback

### Goal
Persist branch feedback samples to Supabase so feedback collected in Vercel deployments can be recovered across browsers/devices instead of staying only in browser localStorage.

### Phases
- [x] Trace current branch-feedback local flow and reuse points from chat/pattern sync
- [x] Add failing regression tests for branch-feedback remote push/pull and merge semantics
- [x] Implement branch-feedback sync runtime, app wiring, and manage visibility
- [x] Verify targeted tests, lint/build, and document the required Supabase table

### Constraints
- Keep branch feedback local-first when Supabase env vars are absent.
- Preserve current dataset/stat APIs so existing suggestion logic does not need to be rewritten.
- Use stable sample IDs so remote pulls merge without duplicating local samples.

### Fix Summary
- Added append-only branch-feedback sync with a dedicated Supabase table (`branch_feedback`) keyed by `sample_id`.
- Kept the existing local dataset format and stats logic intact; remote pulls now merge back into the same per-user localStorage dataset.
- Wired branch-feedback sync into app startup, user confirmation, online/visibility refresh, and the `/manage` diagnostics panel.

## Follow-up: Sync Structure Suggestions

### Goal
Persist non-branch AI suggestion interactions (`return_parent`, `extract_reasoning`, `extract_task_sop`) so all structure-suggestion decisions can be recovered and analyzed across browsers/devices.

### Phases
- [x] Trace structure-suggestion show/accept/dismiss/ignore/expire paths
- [x] Add failing regression tests for structure-suggestion feedback sync and deduping
- [x] Implement a dedicated sync service and wire `ConversationStream` decision logging
- [x] Verify tests, lint/build, and document the new Supabase table SQL

### Constraints
- Keep branch suggestion feedback on the existing `branch_feedback` path.
- Log append-only decision events with a stable `suggestion_id` so lifecycle analysis remains possible.
- Capture both structure-only suggestions and branch-attached extract suggestions.

### Fix Summary
- Added a dedicated `structure_suggestion_feedback` sync service with append-only events keyed by `event_id` and grouped by `suggestion_id`.
- Wired `ConversationStream` to log `shown`, `accepted`, `rejected`, `ignored`, and `expired` decisions for `return_parent`, `extract_reasoning`, and `extract_task_sop`.
- Preserved the existing branch-feedback dataset path while adding separate analytics for non-branch AI suggestions, including branch-attached extract suggestions.

## Follow-up: Store Full Visible Context

### Goal
Capture a compressed version of the full visible conversation context inside suggestion-feedback records so downstream training has richer state without making each row unbounded.

### Phases
- [x] Add regression expectations for `visible_context` in feedback payloads
- [x] Extend feedback record types and runtime payloads
- [x] Capture capped visible QA pairs from `ConversationStream`
- [x] Document the required Supabase column additions

### Constraints
- Keep `visible_context` capped and compressed to avoid large-row performance issues.
- Preserve existing `current_tldr`, `history_last_3_qa`, and `current_node` fields for quick analytics.

## Follow-up: Persist Project Rename Across Refresh

### Goal
Ensure renaming a project survives refresh and remote recovery even when Supabase only allows insert/select on `chat_history`.

### Phases
- [x] Reproduce the rename regression against current remote sync behavior
- [x] Add a failing regression test for remote project-title recovery after rename
- [x] Replace fragile patch-only rename sync with an insert-compatible rename marker flow
- [x] Verify tests and document any schema/policy implications

### Fix Summary

## Follow-up: Reference Study For Map Mode

### Goal
Study [`raulriera/claude-code-canvas`](https://github.com/raulriera/claude-code-canvas) locally to understand its canvas interaction model and identify which ideas could strengthen Context Map's `Map` mode without overcomplicating the product.

### Phases
- [ ] Clone the reference repo into a local subfolder and inspect its structure
- [ ] Run or build the reference project to understand the interaction model
- [ ] Read the key files that define its node/canvas UX and data model
- [ ] Compare the reference patterns against Context Map's current `Canvas / Map / Thread` split
- [ ] Summarize concrete ideas to borrow, adapt, or reject

### Constraints
- Treat the reference app as inspiration, not a drop-in architecture.
- Preserve Context Map's mainline/branch mental model.
- Prefer product insights over a file-by-file code tour.
- Confirmed the old rename path relied on `PATCH chat_history`, which does not actually persist under the current anon insert/select policy setup.
- Added append-only rename marker records to `chat_history` carrying the latest `project_title`.
- Updated reconstruction to use rename markers for title recovery while excluding those markers from visible recovered nodes/mainline.

## Follow-up: Tutorial Example Seed

### Goal
Replace the current generic example project with a first-run tutorial conversation that teaches new users how to read the mainline, inspect branches, return to parent, and understand extraction suggestions.

### Phases
- [x] Add a failing regression test for tutorial-oriented example seed content
- [x] Replace the seeded mainline/branch dialogue in `src/store.ts`
- [x] Verify the seed test, lint, and build

### Constraints
- Keep the existing seed trigger behavior (`user_id === test` or no persisted state).
- Do not change the actual store schema; only replace the seeded content and relationships.
- Use at least one nested branch so `return_parent` can be demonstrated realistically.

## Follow-up: Edit Past Messages

## Follow-up: Search Nodes in Context Map

### Goal
Add a map-local node search tool that searches the current project's full node set, highlights all matches directly in the `Context Map`, and lets the user step through matches without auto-locating into chat.

### Phases
- [x] Add a failing-style regression script for node-search matching and next/prev stepping
- [x] Add pure search helpers for current-project matching and cyclic navigation
- [x] Add `Context Map` toolbar search UI to the left of `Selection`
- [x] Highlight all matches, emphasize the active result, and auto-pan the map when the active result is offscreen
- [x] Verify node-search regression, existing delete-selection regression, lint, and build

### Constraints
- Search scope is the current project's full node set, not only the visible context path.
- Search runs on submit, not live on every keystroke.
- The feature should not auto-locate in chat; it only changes map focus and highlight state.
- Result stepping should cycle like an editor find flow.

### Goal
Allow users to edit past `user` and `assistant` messages directly in the conversation stream so future prompt context uses the edited text, while already-generated downstream messages remain unchanged.

### Phases
- [x] Add a failing-style regression script for node edit and revert semantics
- [x] Add store actions for editing and restoring node content while preserving original text
- [x] Add conversation-stream UI affordances for edit/save/cancel/revert
- [x] Verify message-edit regression, existing chat-history regression, lint, and build

### Constraints
- Editing a past node must not rewrite structure, node IDs, or previously generated descendant nodes.
- Future prompt construction should naturally consume the edited text through the existing `node.content` reads.
- Preserve the original text locally so users can revert.
- Keep remote append-only chat sync unchanged for now; edits are local persisted state, not remote history mutations.

## Follow-up: Paper Master Framing Document

### Goal
Create a detailed master framing document that can serve as the stable foundation for the later paper draft on `Mixed-Initiative Context`.

### Phases
- [x] Re-read the current paper framing and study documents
- [x] Consolidate the stable thesis, main story, RQ rationale, and contribution boundaries
- [x] Write a detailed paper master framing document in `Study/`
- [x] Record the key framing decisions in planning files for future sessions

### Constraints
- Keep the paper centered on the `Mixed-Initiative Context` paradigm rather than a product or UI comparison.
- Treat `linear chat` as a motivation example and symptom of the broader context paradigm, not the core novelty claim.
- Position the current system as a probe / instantiation.
- Treat context-management traces as collected signals and future opportunities, not as already validated learning outputs.
