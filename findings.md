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

## New Findings: Branch Feedback Sync
- Current branch feedback exists only in browser `localStorage` under `context-map.branch-feedback.by-user.v1`; there is no remote sync path today.
- The feedback UI and stats already assume a per-user dataset split into `should_branch` and `should_not_branch`, so the safest remote merge target is that same local dataset shape rather than Zustand app state.
- `accept_branch` is intentionally committed only after the user sends the first message from the created branch, so remote sync must hook into the final append point, not the earlier pending sample.
- The existing app already starts chat-history and pattern sync on boot and refreshes them on user-confirm, network-online, tab-visible, and a 15s interval; branch feedback can reuse that orchestration.
- Append-only feedback needs a stable `sample_id` to avoid duplicate merges after pulling remote rows back into local storage.

## New Findings: Structure Suggestion Feedback
- `return_parent` and `extract_*` suggestions are UI state only today; dismissing or accepting them does not persist any explicit feedback record.
- A single inline surface can show multiple structure items at once, so feedback needs per-suggestion identities rather than one boolean per pending state.
- The cleanest model is an append-only event stream with `suggestion_id` plus `decision` (`shown`, `accepted`, `rejected`, `ignored`, `expired`) so lifecycle analysis survives retries and remote merges.
- Branch-attached extract suggestions (`branch_extract`) should live in the same structure-suggestion table as plain `structure_extract`, because analytically they are both extraction suggestions with different origins.

## New Findings: Project Rename Persistence
- `renameProject()` updates local Zustand state immediately and then calls `syncProjectRename(projectId, newTitle)`.
- The current remote rename path tries to `PATCH chat_history`, but your Supabase setup only grants `insert`/`select`; a live check returned `PATCH 200 []`, and the remote rows kept the old `project_title`.
- Because recovery derives project titles from remote `chat_history` rows, a browser that depends on remote recovery can revert to the old title after refresh.
- The safest fix under insert-only permissions is to append a rename marker row carrying the latest `project_title`, then teach reconstruction to use that title but ignore the marker as a visible chat node.

## New Findings: Tutorial Example Seed
- The existing example project was framed as an internal MVP-building conversation, so first-time users were forced to infer product behavior instead of being guided through it.
- The seed path already supports multi-branch examples out of the box, so the lowest-risk tutorial implementation is to replace only the seeded node content and branch wiring inside `src/store.ts`.
- A nested example branch is worth including in the seed because it gives a concrete, inspectable case for `return_parent`, which is otherwise hard to explain from a flat graph.
- A small scripted regression test can validate tutorial intent by checking the seeded project title, mainline order, and the presence of branch/return/extract cues without depending on UI rendering.

## New Findings: Message Edit in Stream
- The current conversation runtime already derives future prompt context from `Node.content`, so the cheapest correct implementation is to edit `content` in place for future turns instead of introducing a second "effective content" layer across the app.
- To keep the feature reversible, the store should preserve `metadata.original_content` and `metadata.edited_at` only when a node has actually diverged from its original text.
- Keeping `updateNodeContent` separate from manual editing matters because streaming assistant output appends into `content` and must not accidentally mark every generated answer as "edited".
- Existing remote chat-history sync is append-only and keyed to the original logged node snapshots, so this feature currently persists through local Zustand storage but does not propagate edited text to remote recovery. That is a deliberate scope boundary, not an implementation bug.

## New Findings: Context Map Node Search
- `ContextMap.tsx` already owns the full rendered project graph plus the active `ReactFlow` instance, so search can stay entirely local to the map without touching Zustand store shape.
- The safest first release is submit-only text search over `node.content` scoped to the current project, sorted by timestamp for stable editor-like next/prev traversal.
- Search highlighting needs two levels: all matches and the currently focused match. Reusing the normal selected-state styling would be too ambiguous because selection mode and search mode can coexist conceptually.
- Auto-pan should only happen when the active result is offscreen; always re-centering on every next/prev would feel jumpy.
- The user explicitly did not want auto-`Locate`, so search focus and chat-location remain separate actions.

## New Findings: Map Mode Reference Study
- The user wants `Map` to feel meaningfully different from `Thread`, but the earlier topic-map design space was trending too complex for the current product stage.
- A local study of `claude-code-canvas` should focus on interaction model, abstraction level, and how it differentiates canvas exploration from linear thread reading.
- The main evaluation question is not "can we copy its canvas?" but "which pieces reduce complexity while making `Map` clearer as a product concept?"
- `claude-code-canvas` is a lightweight Express + HTML5 Canvas app, not a node-editor stack. It reads Claude session files, groups them as `hub -> project -> branch -> session`, and renders a radial hierarchy.
- Its key product move is abstraction by level, not semantic understanding: the canvas never tries to infer topics. It simply chooses a higher-level unit (`session`) than raw message turns and presents stable groups around that.
- Layout stability is a first-class concern. The radial layout uses golden-angle placement for projects and fixed alternating offsets for branches/sessions so adding new items does not reshuffle existing ones.
- Interaction is intentionally global-view-first: pan, zoom, drag-to-rearrange, collapse/expand, and click-to-resume. There is no attempt to make the canvas itself a detailed editor for the underlying session graph.
- This suggests a lower-complexity direction for Context Map `Map`: differentiate it from `Thread` primarily through aggregation and spatial overview, not through full LLM-driven topic semantics.
