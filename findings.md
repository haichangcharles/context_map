# Findings & Decisions

## Requirements
- Add remote readback for chat history so a new browser/device can recover prior conversations.
- Preserve existing local-first behavior and avoid destructive overwrite of richer local state.
- Be honest about what current `chat_history` schema cannot restore.

## Research Findings
- `chat_history` stores only message snapshots: `message_id`, `project_id`, `parent_id`, `branch_id`, `role`, `content`, timestamps, and `user_id`.
- The remote schema does not store project titles, branch metadata (`intent_summary`, `parent_context_tldr`, status changes), context-view state, or later node/branch mutations like promotions.
- `store.ts` can be repopulated if we can reconstruct `projects`, `nodes`, `branches`, `mainlines`, `naturalMainlines`, and one default `ContextView` per project.
- Because messages already contain `parent_id` and `branch_id`, a best-effort branch graph can be inferred:
  - mainline nodes = messages with `branch_id === null`
  - branch nodes = grouped by `branch_id`, ordered by timestamp
  - branch anchor = parent of the first node in that branch
- The repo still relies on scripted `tsx` tests instead of a unit-test framework.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Implement chat-history pull in the existing `chatHistory.ts` service | The push logic and Supabase config already live there. |
| Reconstruct a minimal usable app graph instead of trying to replay every historical structure mutation | Current remote records lack enough information for exact replay. |
| Merge pulled data into store state rather than resetting existing local data | A browser with richer local state should not lose it because remote schema is lower fidelity. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| `chat_history` schema is lower fidelity than the full local Zustand state | Build and document a best-effort reconstruction path instead of claiming exact recovery. |

## Resources
- `/Users/charles/Downloads/context_map/src/store.ts`
- `/Users/charles/Downloads/context_map/src/services/chatHistory.ts`
- `/Users/charles/Downloads/context_map/src/components/ManagePanel.tsx`
- `/Users/charles/Downloads/context_map/src/App.tsx`

## Sync/Data Findings
- Chat sync uses `context-map.chat-history.by-user.v1`, `context-map.chat-history.pending-sync.v1`, and `context-map.chat-history.sync-status.v1` in `localStorage`.
- Supabase sync is optional; if env vars are absent, local behavior still works.
- The active user id is already available from `branchFeedbackDataset`, so chat-history pull can use the same identity source.
- Exact restoration gaps from current remote schema:
  - project titles are unrecoverable
  - active context selection is unrecoverable
  - branch summaries/status/history mutations are unrecoverable
  - branch promotions/accepted-branch rewrites after original message creation are unrecoverable

## Follow-up Findings: Recovered Title Bug
- The user-reported `Recovered c144d8c` label came from a hardcoded fallback in `reconstructChatStateFromRecords`, not from any dynamic title derivation.
- Recovery can preserve the true title if chat-history rows carry `project_title`; using the latest non-empty title per project is the safest merge rule when titles may be renamed later.
- Adding `project_title` to outgoing rows would break older Supabase tables unless the client either coordinates a migration or retries without that field; the implementation now performs that downgrade automatically.
- Legacy remote rows created before this change still cannot recover exact historical titles unless those rows are re-synced with `project_title` present.

## New Findings: Delete Workflow
- `ContextMap.tsx` already has a reusable selection mode with a floating action bar and node-level selected styling.
- Structural rewrites already flow through `pastStructureSnapshots` / `futureStructureSnapshots`, so delete should be modeled as another structural edit rather than a UI-only mutation.
- The current graph model is a rooted tree over `parent_id`, with `branch.anchor_node_id` introducing view-level splice points; deleting an interior node requires reparenting surviving children or introducing a synthetic placeholder to avoid disconnecting branches.
- `undoStructureChange()` already gives a viable "undo last delete" path as long as delete snapshots are taken in the store action.
- `StructureSnapshot` needed to grow to include `naturalMainlines` and `naturalBranches`; otherwise delete would leave reset-to-natural and undo with stale references to removed nodes.
- A focused before/after preview can stay lightweight: a compact simulated graph of the impacted local segment is enough for confirmation without trying to re-render the full React Flow canvas inside the modal.
- The stronger product requirement turned out to be stricter than that: preview must render the actual candidate context-map structure in-place, not a summary card. That means the map renderer needs a switchable data source (`live` vs `candidate preview`) rather than a separate preview widget.
- `rearrange` was not supposed to restore data, but it was still coupled to whichever structure the main renderer last considered authoritative. The fix is to make layout read from the currently rendered structure only, while delete commit updates both the committed structure and the natural baseline.

## New Findings: Delete Project React Crash
- React production error `#300` corresponds to a hook-order invariant failure, which matches components that execute fewer hooks after the active project disappears.
- `src/components/ConversationStream.tsx` had an early `if (!project || !context) return ...` guard before all hooks were declared.
- The same component still declared additional `useEffect` hooks later in the file, so deleting the active project changed hook count across renders and crashed the app.
- `src/components/ContextMap.tsx` also renders an empty-state message, but its guard is placed after its hooks, so it is not the source of this specific crash.

## New Findings: Deleted Project Reappears
- `deleteProject` removed the project from local state but did not preserve tombstones for the project's deleted node IDs.
- Remote chat-history pull reconstructs projects from historical messages, so stale remote data can immediately recreate a locally deleted project unless those node IDs are still suppressed locally.
- `filterRecoveredChatStateByDeletedNodeIds` correctly removed deleted nodes, but it still retained `projects`/`contexts` entries for projects with zero surviving nodes, which allowed an empty restored project shell to reappear.
- Deleting an entire project needs the same tombstone discipline as deleting selected nodes: preserve deleted node IDs locally and enqueue delete tombstones for remote sync.
