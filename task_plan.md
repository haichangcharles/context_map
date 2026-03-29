# Task Plan: Build paper-cover-figure skill

## Goal
Create a reusable Codex skill for producing strong teaser figures for HCI-style top-tier conference submissions, with concise trigger metadata and practical guidance that another agent can apply directly.

## Current Phase
Phase 1

## Phases

### Phase 1: Requirements & Discovery
- [x] Understand user intent
- [x] Identify core constraints and likely usage
- [x] Review the existing `.skill` package and document findings
- **Status:** complete

### Phase 2: Planning & Structure
- [x] Decide whether to reuse or replace the packaged skill draft
- [x] Define the final skill structure and resource set
- [x] Write the implementation plan and success checks
- **Status:** complete

### Phase 3: Implementation
- [x] Create or update the skill folder in the default Codex skills directory
- [x] Write `SKILL.md`
- [x] Add only the references or assets that materially help with teaser-figure work
- **Status:** complete

### Phase 4: Validation
- [x] Run structural validation
- [x] Run prompt-level spot checks against realistic teaser-figure requests
- [x] Tighten wording if gaps remain
- **Status:** complete

### Phase 5: Delivery
- [ ] Summarize what was created
- [ ] Note assumptions and remaining gaps
- [ ] Point to the final skill location
- **Status:** in_progress

## Key Questions
1. Is the uploaded `.skill` package a usable starting point or an overlong draft that should be replaced?
2. What guidance is essential for HCI teaser figures versus better left out to keep the skill lean?
3. What install location keeps the skill auto-discoverable with minimal user work?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Default install target is `~/.codex/skills/paper-cover-figure` | `skill-creator` recommends the auto-discovered Codex skills path when the user does not specify a custom location. |
| Use planning files for this task | The task is multi-step and exceeds the threshold for `planning-with-files`. |
| Use manual scenario review instead of subagent testing | The superpowers bootstrap notes that subagents are not available in Codex here. |
| Replace the packaged skill draft instead of installing it unchanged | The draft contains valuable domain knowledge but is too long and too tied to image-generation prompting. |
| Install the finished skill and also ship a packaged archive | This gives the user both immediate usability and portability. |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `set_title.sh` could not write `/Users/charles/.claude/terminal_title.tmp.*` | 1 | The title escape sequence still executed; no further action needed for this task. |

## Notes
- Keep the skill compact and trigger-oriented.
- Prefer a fresh rewrite over patching a bloated draft if the packaged version is too long or redundant.

## 2026-03-29 Context Map Node State Clarity

### Goal
Make Context Map node states legible by introducing a strict four-state visual model and explicit scope messaging so users can tell active context from merely visible structure.

### Current Phase
Phase 4

### Phases

#### Phase 1: Discovery
- [x] Confirm current active / included / excluded rendering rules
- [x] Confirm whether mainline view still renders branch structure
- [x] Capture the user confusion in planning notes
- **Status:** complete

#### Phase 2: Test Design
- [x] Add a focused regression test for four-state visual precedence
- [x] Verify the test fails before implementation
- **Status:** complete

#### Phase 3: Implementation
- [x] Extract node visual-state logic from `ContextMap.tsx`
- [x] Update node cards, badges, and legend to show four primary states
- [x] Add scope copy that explains mainline vs branch visibility
- **Status:** complete

#### Phase 4: Verification
- [x] Run targeted state tests
- [x] Run typecheck
- [x] Check for visual regressions in related context-map affordances
- **Status:** complete

#### Phase 5: Natural Reset Semantics
- [x] Confirm current implementation lacks a natural reset path
- [x] Redefine include/exclude/invert around effective context membership
- [x] Add `Natural` as an explicit batch action
- [x] Verify toggle and invert behavior with tests
- **Status:** complete

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Keep store inclusion semantics for now and fix the UI model first | The user confusion is caused primarily by visual ambiguity, not missing storage states. |
| Treat mainline as a scope, not as the only visible structure | The current map intentionally shows branch structure while on mainline; the UI needs to say that explicitly. |
| Let explicit include override active in visual precedence | This makes green reachable and makes explicit user intent visible even on active-path nodes. |
| Normalize batch include/exclude so they do not create redundant overrides | Explicit include on naturally active nodes and explicit exclude on naturally inactive nodes only add confusion. |
| Define invert as a flip of effective context membership, not as a synonym for cycling explicit tags | This keeps invert deterministic now that natural is a first-class state. |

### Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `ERR_MODULE_NOT_FOUND` for `src/utils/contextMapNodeState` | 1 | Expected RED step for TDD; added the new helper module and re-ran the test. |
| Updated inclusion test failed on second click for active nodes | 1 | Expected RED step; changed store toggle semantics to restore natural state instead of forcing explicit include. |

### Notes
- White nodes should communicate "visible structure only", not "already included".
- Green must be reachable without depending on users understanding current-path internals.
- `Natural` now means "clear explicit include/exclude overrides and defer to base path visibility."
