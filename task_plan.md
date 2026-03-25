# Task Plan: Mainline Branch Explosion Investigation

## Goal
Determine whether selecting a mainline start and a branch endpoint with nested sub-branches causes real node duplication or a projection/layout bug, and identify whether a safe fix is localized enough to attempt.

## Current Phase
Phase 2

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
- **Status:** in_progress

### Phase 3: Implementation
- [ ] Add a failing reproduction for the explosion scenario if reproducible
- [ ] Implement minimal fix only after root cause is confirmed
- [ ] Keep changes scoped to branch endpoint restructuring
- **Status:** pending

### Phase 4: Testing & Verification
- [ ] Run targeted diagnostics / regression tests
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
2. Does the reported “18 nodes become 32” come from `state.nodes`, visible-node projection, or Context Map layout nodes?
3. When a branch is only partially absorbed into the mainline, should its `anchor_node_id` move to the new split point?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| First prove whether the explosion is real node creation or projection-layer inflation | The risk and fix surface are very different. |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `set_title.sh` could not write `/Users/charles/.claude/terminal_title.tmp.*` due to sandbox permissions | 1 | Title escape sequence still executed; no further action needed for this task. |
| `tsx` could not create its IPC pipe inside the sandbox (`listen EPERM`) | 1 | Re-ran the relevant test commands with escalated permissions. |

## Notes
- Follow systematic debugging first: identify the current mutation path before changing code.
- Follow TDD strictly: failing test before implementation.

---

## Supplemental Task: Study Summary Request (2026-03-25)

### Goal
Describe, in Chinese, what study this system supports, based on the `Study/` notes and the paper sections.

### Phases
- [x] Load required skills and planning workflow
- [x] Check existing planning files for context
- [x] Read study notes and paper sections
- [x] Synthesize a concise system-study description for the user

### Notes
- Keep the existing branch-investigation record intact; append only study-summary notes for this request.

---

## Supplemental Task: Structure Prompt Study Tuning (2026-03-25)

### Goal
Append two new study-facing structure-suggestion cases so the system more readily suggests branching for parallel option exploration and suggests returning upward when the user appears locally finished.

### Phases
- [x] Load required skills and planning workflow
- [x] Locate the active structure suggestion prompt and tests
- [x] Append one new branch case and one new return case without altering existing prompt text
- [x] Run the targeted prompt test and capture the result

### Notes
- Keep the change additive only inside the structure suggestion prompt examples.
