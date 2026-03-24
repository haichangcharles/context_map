# Findings & Decisions

## Requirements
- When a node inside the existing mainline is chosen as the new mainline boundary, any nodes that used to come after it on the old mainline should no longer stay on the mainline.
- Those trailing nodes should remain connected as a branch rooted at the new terminal mainline node.
- The new terminal mainline node therefore also acts as an anchor/branch attachment point.
- The behavior should work whether the chosen boundary node is a `Q` or an `A`.

## Research Findings
- The task is specifically about resetting the mainline to an interior node, not appending a new branch from the current tail.
- The expected graph invariant is "mainline remains contiguous, truncated suffix survives as a branch."
- `src/store.ts` contains the main application graph logic for `mainline`, `branch`, and `anchor` state.
- `scripts/test-mainline-endpoints.ts` already appears to cover mainline endpoint behavior and is the most likely place for the new regression test.
- `setMainlineEndpoints(projectId, startId, endId)` computes an undirected shortest path between the two selected nodes, makes exactly that path the new mainline, then auto-branches any nodes that fell out of mainline and previously had `branch_id === null`.
- Auto branches are currently grouped by the nearest ancestor that remains on the new mainline, and new branch records are created with `anchor_node_id` equal to that ancestor.
- The missing logic was not the suffix auto-branch itself; it was the existing child branches under that suffix. Their `parent_branch_id` stayed `null`, so they did not become nested under the new suffix branch.
- A regression scenario that truncates `r1 -> r2 -> r3 -> r4 -> r5` down to `r1 -> r2 -> r3` while keeping a child branch anchored at `r4` failed before the fix and now passes.
- Undo/redo already restores this reanchored parent relation because structure history snapshots store the full `branches` table, not only the `mainline`.
- The new bug report is different from the previous reanchor bug: it suggests node-count inflation after choosing a mainline start and a branch endpoint that still has nested sub-branches beneath it.
- Both [src/components/ConversationStream.tsx](/Users/charles/Downloads/context_map/src/components/ConversationStream.tsx) and [src/components/ContextMap.tsx](/Users/charles/Downloads/context_map/src/components/ContextMap.tsx) maintain their own `resolveVisibleNodesForBasePath` implementation, so a projection-layer duplication bug is plausible even if `state.nodes` itself stays at 18.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Treat this as a model-level invariant and verify it through existing graph/model tests | The behavior affects structure semantics, not only UI state. |
| Recompute branch parentage from each branch's anchor node after endpoint resets | Branch nesting should always reflect the anchor node's current containing branch. |
| Lock the undo/redo guarantee with a regression test instead of relying only on snapshot inspection | The code strongly suggests it works, but the test should prove the exact before/after relationship. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| `tsx` test commands could not open their IPC pipe inside the sandbox | Re-ran targeted tests with escalated permissions. |

## Resources
- `task_plan.md`
- `src/store.ts`
- `scripts/test-mainline-endpoints.ts`
- `scripts/test-nested-branch.ts`
- `src/components/ConversationStream.tsx`
- `src/components/ContextMap.tsx`

## Visual/Browser Findings
- None.

---
*Update this file after every 2 view/browser/search operations*
*This prevents visual information from being lost*
