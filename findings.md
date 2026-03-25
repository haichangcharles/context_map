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

## 2026-03-25 Study Summary Request

### Early Findings
- Existing planning files mostly document a separate branch-structure debugging task, not the study narrative itself.
- The repository contains a dedicated `Study/` folder plus paper sections including `4_Probe_System.tex`, `5_Study_Design.tex`, `6_Findings_and_Result.tex`, and `9_Conclusions.tex`.
- The active user request is interpretive: explain what study the system enabled, rather than modify code.

### Source Review Round 1
- The paper frames `Mixed-Initiative Context` as the main conceptual contribution: context becomes an explicit, structured, and operable object in human-AI collaboration.
- `Contextify` is the probe system used to instantiate that concept in a conversational setting; the paper explicitly says the contribution is not a new chat UI by itself.
- In `Contextify`, each user input and AI output is treated as an addressable node, and users can branch, include/exclude, edit, re-branch, and redefine the mainline path.
- The context canvas makes structural operations explicit through node selection, state toggling, path restructuring, and pattern extraction.
- The system also introduces mixed-initiative behavior at the context layer: AI can suggest branching, returning to the mainline, or extracting reusable patterns.
- `paper/sections/5_Study_Design.tex` is currently empty, so the concrete study procedure must be reconstructed from the `Study/` folder rather than the paper section itself.

### Source Review Round 2
- The study is explicitly formative and probe-based, not a product benchmark; the baseline is familiar linear chat (e.g. ChatGPT), and the probe is the current system.
- Design: within-subject, minimal-risk, remote moderated sessions with 6 participants, 45 minutes each, plus screen/audio recording, interviewer notes, and prototype interaction logs.
- Each participant completes two matched open-ended hardware-concept ideation tasks under counterbalanced tool/task order.
- The tasks are intentionally open enough to create multiple plausible paths, trade-offs, and topic shifts, so that context organization becomes naturally useful without instructing participants to branch.
- Data collection focuses on behavior and interpretation: when users separate paths, include/exclude information, revisit earlier threads, accept or resist AI structure suggestions, and how they describe workflow, control, clarity, and cognitive load.
- `paper/sections/6_Findings_and_Result.tex` is also empty; likely findings must be inferred from planning notes or later paper sections rather than that draft file.

### Source Review Round 3
- The most accurate one-sentence description is: the system supports a formative probe study of `Mixed-Initiative Context`, comparing a structured context-management prototype with linear chat in order to understand strategy, negotiation, and experience.
- The study does not primarily ask whether the prototype is faster or better overall; it asks what changes when context becomes a first-class object of interaction.
- The likely reporting structure is organized by three questions:
  - how users strategically manage explicit context;
  - how they understand and negotiate AI initiative in context organization;
  - how the paradigm changes workflow, control, clarity, and cognitive burden.
- Several paper section files (`5_Study_Design.tex`, `6_Findings_and_Result.tex`, `7_Design_Implications.tex`, `9_Conclusions.tex`) are still empty, so any description should be grounded in the `Study/` planning docs and working drafts rather than those section files.

---

## 2026-03-25 Structure Prompt Study Tuning

### Early Findings
- The active Branch / return suggestion behavior is defined in `buildStructureSuggestionSystemPrompt()` inside `src/utils/promptBuilders.ts`.
- The existing prompt already separates guidance into `branch` and `return_parent` sections, each with explicit example bullets, so the safest change is additive.
- `scripts/test-structure-prompts.ts` already verifies key structure-prompt phrases and is the minimal targeted regression point for these new cases.

### Technical Decision
| Decision | Rationale |
|----------|-----------|
| Add one new example bullet under `branch` and one under `return_parent` | This satisfies the request to add two cases only, without rewriting existing prompt logic or instructions. |

---
*Update this file after every 2 view/browser/search operations*
*This prevents visual information from being lost*
