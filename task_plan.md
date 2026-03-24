# Task Plan: Mainline Reanchor Regression

## Goal
Ensure that when the mainline start/end is reset to an interior node, any trailing nodes that used to remain on the old mainline are reattached as a branch from the new terminal node, and that terminal node is treated as an anchor.

## Current Phase
Phase 5

## Phases

### Phase 1: Requirements & Discovery
- [x] Understand user intent
- [x] Identify constraints and requirements
- [x] Document findings in findings.md
- **Status:** complete

### Phase 2: Planning & Structure
- [x] Define technical approach
- [x] Identify affected model and tests
- [x] Document decisions with rationale
- **Status:** complete

### Phase 3: Implementation
- [x] Add failing regression test
- [x] Implement minimal fix
- [x] Keep changes scoped to mainline/branch anchor behavior
- **Status:** complete

### Phase 4: Testing & Verification
- [x] Run targeted tests
- [x] Document test results in progress.md
- [x] Fix any issues found
- **Status:** complete

### Phase 5: Delivery
- [x] Review touched files
- [x] Summarize behavior change and remaining risks
- [ ] Deliver to user
- **Status:** in_progress

## Key Questions
1. Which function mutates mainline membership when the user resets the mainline start/end?
2. How are anchors and branch roots represented today when a mainline is truncated in the middle?
3. Which existing tests already cover adjacent behavior so the new test matches the established model semantics?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Start with a regression test around reanchoring trailing mainline nodes | This is a behavior bug; the test should define the exact expected graph shape before implementation. |
| Recompute `parent_branch_id` after `setMainlineEndpoints` reassigns node `branch_id`s | Existing child branches anchored on the truncated suffix must become nested under the new auto branch rooted at the new mainline terminal node. |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `set_title.sh` could not write `/Users/charles/.claude/terminal_title.tmp.*` due to sandbox permissions | 1 | Title escape sequence still executed; no further action needed for this task. |
| `tsx` could not create its IPC pipe inside the sandbox (`listen EPERM`) | 1 | Re-ran the relevant test commands with escalated permissions. |

## Notes
- Follow systematic debugging first: identify the current mutation path before changing code.
- Follow TDD strictly: failing test before implementation.
