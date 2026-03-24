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

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Treat this as a model-level invariant and verify it through existing graph/model tests | The behavior affects structure semantics, not only UI state. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| None yet | - |

## Resources
- `task_plan.md`
- `src/store.ts`
- `scripts/test-mainline-endpoints.ts`

## Visual/Browser Findings
- None.

---
*Update this file after every 2 view/browser/search operations*
*This prevents visual information from being lost*
