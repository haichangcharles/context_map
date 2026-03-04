# Task Plan: Context Map SDK Scaffold

## Goal
Create a reusable SDK scaffold so Context Map can be embedded into third-party apps as a repeatable wheel.

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
- [x] Create SDK folder structure
- [x] Document decisions with rationale
- **Status:** complete

### Phase 3: Implementation
- [x] Create `sdk/` workspace with packages and docs
- [x] Add core/react/adapters placeholders and contracts
- [x] Add quickstart and integration guidance
- **Status:** complete

### Phase 4: Testing & Verification
- [x] Verify folder structure and key files
- [x] Ensure docs align with existing project capabilities
- [x] Log verification results
- **Status:** complete

### Phase 5: Delivery
- [x] Summarize created files and design choices
- [x] Provide next execution options
- **Status:** complete

## Key Questions
1. How to decouple core conversation-graph logic from UI/store?
2. What host-facing API should make embedding minimal and stable?
3. Which packaging strategy supports both open-source reuse and future commercial extensions?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Start with scaffold + contracts, not full extraction | Fast path to reusable template without risky large refactor in one pass |
| Use Engine + SDK + Adapter layering | Keeps core logic framework-agnostic and makes host integration flexible |
| Add root README pointers to sdk/ docs | Makes SDK path visible to integrators immediately |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
|       | 1       |            |

## Notes
- Keep docs actionable for external integrators.
- Reuse current domain model vocabulary (project/node/branch/mainline/context/pattern).
