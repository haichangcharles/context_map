# Findings & Decisions

## Requirements
- User wants a new Codex skill for creating teaser figures used in top HCI conference submissions.
- The skill should help with paper-cover / teaser-figure style work rather than general illustration.
- The user pointed at `/Users/charles/Downloads/paper-cover-figure.skill`, which is a packaged skill artifact and likely a starting draft.

## Research Findings
- The repository-level instructions required running the superpowers bootstrap before any other task work.
- Relevant skills for this task are `terminal-title`, `planning-with-files`, `skill-creator`, `superpowers:brainstorming`, `superpowers:test-driven-development`, `superpowers:writing-plans`, and `superpowers:writing-skills`.
- The uploaded `.skill` file is a zip archive containing:
  - `paper-cover-figure/SKILL.md`
  - `paper-cover-figure/references/archetypes.md`
  - `paper-cover-figure/references/example_prompt.md`
- `skill-creator` recommends defaulting new skills to `~/.codex/skills` when the user does not specify a location.
- `writing-skills` expects RED/GREEN/REFACTOR validation, but subagents are unavailable in this Codex environment, so validation must be approximated with manual scenario checks.
- The packaged `SKILL.md` is usable as source material but is too long for a lean skill and over-optimizes for one output mode: generating prompts for image-generation tools.
- The packaged draft contains strong domain knowledge worth preserving:
  - HCI teaser figures should teach the contribution within about 10 seconds.
  - Figure choice benefits from reusable archetypes such as scenario, pipeline, comparison, photo grid, and layered architecture.
  - A separate text-overlay plan matters because final academic figures are usually finished in Figma, Illustrator, or Keynote rather than accepted directly from an image model.
- The packaged draft also carries avoidable bloat:
  - Overly detailed image-generator prompt micro-specification.
  - Venue-specific examples embedded directly in the main skill body.
  - Repetition that belongs in references rather than `SKILL.md`.
- Manual spot checks against two realistic requests suggest the rewritten skill behaves correctly:
  - A collaborative AR sensemaking paper naturally maps to `Scenario + architecture hybrid`.
  - A baseline-vs-new-interface improvement paper naturally maps to `Paired comparison`.
  - In both cases, the skill defaults to an editable figure brief and text-overlay plan rather than forcing an image-generation workflow.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Treat the uploaded package as an input artifact, not automatically as the final deliverable | The package may already contain a draft, but it still needs quality review against the user's actual HCI teaser-figure use case. |
| Create planning files in the workspace root | Required by `planning-with-files`. |
| Rewrite the skill into a leaner version instead of installing the packaged draft verbatim | The current draft is too narrow and too long for efficient skill invocation. |
| Keep archetypes and worked prompts in `references/` | They are useful but should not bloat the main skill body. |
| Produce both an installed skill and a packaged `.skill` artifact | The installed version is directly usable by Codex, while the archive is portable. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| `superpowers-codex use-skill skill-creator` failed | The correct superpowers name is `.system/skill-creator`, while the personal skill content was still directly readable from the provided path. |
| Terminal title helper could not write a temporary file in `.claude` | Ignored after confirming the escape sequence still set the title. |

## Resources
- Skill creator: `/Users/charles/.codex/skills/.system/skill-creator/SKILL.md`
- Writing skills: `/Users/charles/.codex/superpowers/skills/writing-skills/SKILL.md`
- Uploaded package: `/Users/charles/Downloads/paper-cover-figure.skill`
- Final workspace skill: `/Users/charles/Downloads/context_map/paper-cover-figure`
- Installed skill: `/Users/charles/.codex/skills/paper-cover-figure`
- Final packaged artifact: `/Users/charles/Downloads/context_map/paper-cover-figure.skill`

## Visual/Browser Findings
- None yet.

---

## 2026-03-29 Context Map Node State Clarity

### Research Findings
- The current Context Map uses overlapping booleans instead of a single visual-state model: `isActive`, `isIncluded`, `isExcluded`, `isSelected`, `isDeleteSelected`, `isSearchMatch`, and `isPlaceholder` all compete for styling in [src/components/ContextMap.tsx](/Users/charles/Downloads/context_map/src/components/ContextMap.tsx).
- Under the current precedence, explicit include only renders green when `isIncluded && !isActive`, so users can operate the include toggle and still never see green if they mostly touch active-path nodes.
- Excluded nodes are styled with reduced opacity, dashed red border, and pale red background. In practice this reads as "grayed out" more than "explicitly excluded".
- Mainline view does still render branches. This happens because Context Map lays out project branch groups independently of the current `base_path`, while `activeNodeIds` only marks the active path subset.
- The user confusion is therefore structurally valid:
  - white nodes are visible but not active
  - blue nodes are active
  - green is rare enough to appear broken
  - excluded can look gray instead of clearly red

### Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Introduce a dedicated four-state visual helper | State precedence should be explicit and testable outside the JSX class list. |
| Add scope copy to the map chrome | Users need a direct statement that mainline view can still show non-active branches. |
| Let explicit include win over active in the visual layer | This makes green observable and surfaces explicit user intent instead of burying it under blue active styling. |

### Verification Findings
- A new targeted regression test failed first with `ERR_MODULE_NOT_FOUND`, then passed after introducing `src/utils/contextMapNodeState.ts`.
- The existing inclusion-toggle test still passes, so the store behavior was not changed by the UI refactor.
- TypeScript typecheck passes.
- Production build passes. Vite still reports the pre-existing large-chunk warning, but no new build error was introduced.

## 2026-03-29 Natural Reset And Invert Semantics

### Research Findings
- The current store had no way to return a node to natural state once it entered explicit include/exclude. `cycleNodeInclusionState()` only bounced between effective include and effective exclude.
- `Invert` was not an independent operation. The batch handler simply called `cycleNodeInclusionState()` for each selected node, so its behavior depended on the same hidden toggle path.
- This made the user complaint accurate: there was no explicit "clear override" action, and invert semantics were hard to reason about.

### Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Add `natural` to batch inclusion actions | Users need a direct way to remove explicit overrides. |
| Redefine single-node click as `natural <-> opposite override` | Clicking should quickly toggle against the base path and back, not force users through redundant explicit states. |
| Normalize `include` and `exclude` actions | `include` should only add explicit include when a node is naturally out of context; `exclude` should only add explicit exclude when a node is naturally in context. |
| Define `invert` in terms of effective context membership | Running invert twice should return the selection to natural state. |

### Verification Findings
- The updated inclusion test failed first on the second click of an active node, proving the old implementation could not restore natural state.
- After the store changes, the same test now confirms:
  - active node click: natural -> exclude -> natural
  - inactive node click: natural -> include -> natural
  - batch include/exclude avoid redundant overrides
  - batch invert twice returns to natural

### Resources
- [src/store.ts](/Users/charles/Downloads/context_map/src/store.ts)
- [src/components/shared/ContextMapSelectionActionBar.tsx](/Users/charles/Downloads/context_map/src/components/shared/ContextMapSelectionActionBar.tsx)
- [scripts/test-node-inclusion-toggle.ts](/Users/charles/Downloads/context_map/scripts/test-node-inclusion-toggle.ts)

### Resources
- [src/components/ContextMap.tsx](/Users/charles/Downloads/context_map/src/components/ContextMap.tsx)
- [src/store.ts](/Users/charles/Downloads/context_map/src/store.ts)
- [src/components/ConversationStream.tsx](/Users/charles/Downloads/context_map/src/components/ConversationStream.tsx)
- [scripts/test-node-inclusion-toggle.ts](/Users/charles/Downloads/context_map/scripts/test-node-inclusion-toggle.ts)
- [src/utils/contextMapNodeState.ts](/Users/charles/Downloads/context_map/src/utils/contextMapNodeState.ts)
- [scripts/test-context-map-node-state.ts](/Users/charles/Downloads/context_map/scripts/test-context-map-node-state.ts)
