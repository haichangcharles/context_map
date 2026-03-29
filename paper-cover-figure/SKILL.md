---
name: paper-cover-figure
description: Use when Codex needs to create or refine a teaser figure, paper cover figure, Figure 1 hero visual, or visual concept for an HCI-style research paper, especially for CHI, UIST, CSCW, DIS, or IMWUT, including choosing a figure archetype, turning a contribution into a visual story, planning overlay text, or drafting an optional image-generation prompt.
---

# Paper Cover Figure

## Overview

Turn a paper contribution into a figure brief that communicates the main claim in about 10 seconds. Default to an editable figure specification with layout, focal point, and text-overlay plan; generate an image-model prompt only when the user explicitly wants one.

## Quick Triage

If the user only has an abstract or summary:
- extract the claim, mechanism, scenario, and evidence before proposing visuals

If the user has screenshots, photos, device renders, or study artifacts:
- anchor the figure in those assets instead of inventing a generic scene

If the user asks for "Figure 1", "teaser figure", or "cover figure":
- optimize for fast comprehension, not decorative polish

If the user asks for a Midjourney, DALL-E, Imagen, or similar prompt:
- still produce a separate text-overlay plan because the final academic figure will usually be finished in Figma, Illustrator, or Keynote

## Input Checklist

Request only the missing inputs that materially affect the figure:
- paper title, abstract, or one-paragraph summary
- one-sentence main contribution
- target venue or paper style
- available assets such as screenshots, photos, device mockups, or diagrams
- figure constraints such as single panel, multi-panel, Figure 1, or camera-ready width
- desired output mode: concept brief, full figure spec, or image prompt

## Choose The Archetype

Use this quick mapping first. Read `references/archetypes.md` only when the choice is unclear or the figure is complex.

| Contribution shape | Default archetype | Why |
|---|---|---|
| interactive system, wearable, embodied AI, AR/VR | Scenario illustration | Ground the system in a real moment |
| data transformation, inference chain, model pipeline | Transformation pipeline | Show how input becomes output |
| "our method vs prior method" | Paired comparison | Make the improvement legible fast |
| step-by-step physical task or guidance | Annotated photo grid | Use sequence and real context |
| complex system paper with both scenario and mechanism | Scenario + architecture hybrid | Combine hook plus explanation |

Prefer one primary archetype. Combine only when the paper truly needs both context and mechanism.

## Workflow

### 1. Extract the visual story

Define:
- the single sentence the reader should remember
- the concrete scenario or anchor artifact
- the system action or transformation that must be visible
- the evidence of improvement or novelty

If you cannot express the figure in one sentence, the concept is still too broad.

### 2. Pick one focal point

Reserve the strongest visual emphasis for one "money shot": the key overlay, before/after difference, missing object, prediction, recommendation, or outcome. Let other elements support it.

### 3. Build the composition

Specify:
- overall layout and panel count
- which region gets the most space
- what each panel must show
- how the viewer's eye should travel

For scenario + architecture hybrids, let the scenario dominate and use the mechanism panel as support, not a second main figure.

### 4. Plan the text separately

Create a text-overlay plan with:
- title or figure header
- 3-7 short labels or captions
- one punchline takeaway if needed

Keep generator outputs text-free. Academic figures usually need post-production text added by hand.

### 5. Produce the deliverable

Return some or all of:
- figure concept summary
- chosen archetype and reason
- layout spec
- must-show visual elements
- text-overlay plan
- optional image-generation prompt
- post-production notes

## Default Output Format

Use this structure unless the user asks for something else:
1. Core message
2. Chosen archetype
3. Layout and panel plan
4. Visual elements to include
5. Text overlay plan
6. What to avoid
7. Optional image prompt

## Image Prompt Mode

When the user explicitly wants an image-model prompt:
- keep the prompt grounded in the paper's actual scenario, objects, interfaces, and evidence
- forbid generated text in the image
- describe clean empty label zones instead of asking the model to render text
- specify one accent-color hierarchy and one focal element
- avoid generic "futuristic UI" styling unless the paper truly needs it

Read `references/example-prompts.md` for worked patterns.

## Quality Bar

Aim for figures that:
- communicate the claim in about 10 seconds
- feel specific to this paper, not swappable with another paper in the same area
- privilege concrete scenes, artifacts, or screenshots over abstract icon soup
- show mechanism when it matters, not only outcome
- stay editable after generation

## Common Mistakes

| Mistake | Correction |
|---|---|
| generic user in generic room | Pick one specific person, task, place, and objects |
| too many contributions in one figure | Reduce to one main claim and one supporting mechanism |
| equal-weight hybrid panels | Give one panel the visual lead |
| decorative icons and sci-fi chrome | Use content-specific objects, screenshots, and overlays |
| relying on generated text | Reserve clean text zones and add text in post-production |
| beautiful image but no paper story | State the contribution, novelty, and evidence explicitly |

## References

- Read `references/archetypes.md` for archetype selection and composition heuristics.
- Read `references/example-prompts.md` when the user wants a worked brief or image-prompt pattern.
