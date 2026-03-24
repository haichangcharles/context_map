# Findings & Decisions

## Requirements
- Investigate a new bug where choosing a mainline start and a branch endpoint with nested sub-branches appears to make the system “explode” from about 18 nodes to about 32.
- Determine whether the inflation is in stored nodes, visible-node projection, or Context Map layout/render state.
- Avoid blind fixes until the exact failing structure is understood.

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
- In two synthetic nested-branch graphs and the built-in tutorial graph, `state.nodes` count remained constant after `setMainlineEndpoints`, visible-node projections did not produce duplicate `node_id`s, and computed Context Map node count did not exceed project node count.
- In those same synthetic runs, a different structural inconsistency appeared: when the mainline absorbs only the prefix of a branch, the surviving remainder of that branch keeps its old `anchor_node_id` instead of rebasing to the new split point.
- That stale anchor causes branch views to lose the newly promoted prefix context. Example: after selecting `n2 -> a3`, the remaining branch rooted conceptually at `a3` still reports `anchor_node_id = n3`, so its visible path becomes `[n2, n3, a4, a5]` instead of including the promoted prefix through `a3`.
- The user-provided UI reproduction (`User 2` as mainline start, `User 5` as mainline end) matches this exact failure mode: `Assistant 5` stayed attached to the original branch anchor near `User 2` instead of becoming a branch off `User 5`.
- A focused regression test confirmed the bug and passed after re-deriving each branch's `anchor_node_id` from the first remaining node in that branch after `setMainlineEndpoints` rewrites node membership.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Do not patch the reported explosion blindly yet | Current diagnostic sweeps do not reproduce real node-count inflation. |
| Treat stale `anchor_node_id` after partial branch promotion as the leading root-cause candidate | It is a concrete inconsistency observed in the model after `setMainlineEndpoints`. |
| Fix branch remainder anchoring before chasing projection-layer duplication theories | The user-provided reproduction maps cleanly to this structural bug and the regression is now reproducible. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| `tsx` test commands could not open their IPC pipe inside the sandbox | Re-ran targeted tests with escalated permissions. |
| The reported “18 -> 32 nodes” symptom was not reproducible in synthetic or tutorial graphs | Narrowed the likely root cause to a graph-shape-specific projection bug or stale branch-anchor metadata. |

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
