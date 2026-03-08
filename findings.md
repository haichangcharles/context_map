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
