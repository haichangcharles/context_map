# Task Plan: Mainline Reanchor Regression

## Goal
Ensure that when the mainline start/end is reset to an interior node, any trailing nodes that used to remain on the old mainline are reattached as a branch from the new terminal node, and that terminal node is treated as an anchor.

## Current Phase
Phase 1

## Phases

### Phase 1: Requirements & Discovery
- [x] Understand user intent
- [x] Identify constraints and requirements
- [ ] Document findings in findings.md
- **Status:** in_progress

### Phase 2: Planning & Structure
- [ ] Define technical approach
- [ ] Identify affected model and tests
- [ ] Document decisions with rationale
- **Status:** pending

### Phase 3: Implementation
- [ ] Add failing regression test
- [ ] Implement minimal fix
- [ ] Keep changes scoped to mainline/branch anchor behavior
- **Status:** pending

### Phase 4: Testing & Verification
- [ ] Run targeted tests
- [ ] Document test results in progress.md
- [ ] Fix any issues found
- **Status:** pending

### Phase 5: Delivery
- [ ] Review touched files
- [ ] Summarize behavior change and remaining risks
- [ ] Deliver to user
- **Status:** pending

## Key Questions
1. Which function mutates mainline membership when the user resets the mainline start/end?
2. How are anchors and branch roots represented today when a mainline is truncated in the middle?
3. Which existing tests already cover adjacent behavior so the new test matches the established model semantics?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Start with a regression test around reanchoring trailing mainline nodes | This is a behavior bug; the test should define the exact expected graph shape before implementation. |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `set_title.sh` could not write `/Users/charles/.claude/terminal_title.tmp.*` due to sandbox permissions | 1 | Title escape sequence still executed; no further action needed for this task. |

## Notes
- Follow systematic debugging first: identify the current mutation path before changing code.
- Follow TDD strictly: failing test before implementation.
