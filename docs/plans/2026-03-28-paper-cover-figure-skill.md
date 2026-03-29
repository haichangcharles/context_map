# Paper Cover Figure Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a Codex skill that helps agents design strong teaser figures for HCI-style conference papers.

**Architecture:** Start from the uploaded package only if its guidance is concise and targeted. Otherwise, create a clean skill in `~/.codex/skills/paper-cover-figure` with a compact `SKILL.md` and a small `references/` set for visual archetypes and example prompts.

**Tech Stack:** Markdown skill files, optional reference docs, Python validator from `skill-creator`.

### Task 1: Review the uploaded artifact

**Files:**
- Inspect: `/Users/charles/Downloads/paper-cover-figure.skill`
- Review: packaged `paper-cover-figure/SKILL.md`
- Review: packaged `paper-cover-figure/references/archetypes.md`
- Review: packaged `paper-cover-figure/references/example_prompt.md`

**Step 1: Inspect the packaged contents**

Run: `unzip -l /Users/charles/Downloads/paper-cover-figure.skill`
Expected: A `SKILL.md` and a minimal reference set.

**Step 2: Read the packaged guidance**

Run: `unzip -p /Users/charles/Downloads/paper-cover-figure.skill paper-cover-figure/SKILL.md | sed -n '1,220p'`
Expected: The current draft reveals whether the skill is concise, trigger-friendly, and usable.

**Step 3: Record gaps**

Write the findings into `findings.md`.

### Task 2: Create the failing validation target

**Files:**
- Create or update: `/Users/charles/Downloads/context_map/findings.md`

**Step 1: Define realistic prompts**

Create 2-3 representative teaser-figure requests such as:
- “Design a teaser figure for a CHI paper on collaborative AR sensemaking.”
- “Help me turn a dense HCI system into a clean teaser figure with one hero concept.”

**Step 2: Evaluate whether the current artifact would guide an agent well**

Expected: Identify missing trigger language, missing workflow guardrails, or unnecessary verbosity.

### Task 3: Build the final skill

**Files:**
- Create: `~/.codex/skills/paper-cover-figure/SKILL.md`
- Create if needed: `~/.codex/skills/paper-cover-figure/references/archetypes.md`
- Create if needed: `~/.codex/skills/paper-cover-figure/references/example-prompts.md`

**Step 1: Write metadata**

Use only:

```yaml
---
name: paper-cover-figure
description: Use when Codex needs to create or refine a teaser figure, paper cover figure, or hero visual for HCI-style research papers, especially for venues such as CHI, UIST, CSCW, or IMWUT where the figure must communicate the system contribution quickly and credibly.
---
```

**Step 2: Write the minimal body**

Include:
- Overview and core principle
- Input checklist
- Figure construction workflow
- Common failure modes
- Reference links for archetypes and prompts

**Step 3: Keep the skill lean**

Move extended examples to `references/` instead of bloating `SKILL.md`.

### Task 4: Validate and tighten

**Files:**
- Verify: `~/.codex/skills/paper-cover-figure/SKILL.md`

**Step 1: Run structural validation**

Run: `python /Users/charles/.codex/skills/.system/skill-creator/scripts/quick_validate.py ~/.codex/skills/paper-cover-figure`
Expected: `Skill is valid!`

**Step 2: Run prompt-level spot checks**

Check the final skill against the representative requests from Task 2.

**Step 3: Tighten wording**

If any prompt would still leave the agent too much ambiguity, refine the guidance and re-run validation.
