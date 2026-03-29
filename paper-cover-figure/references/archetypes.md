# Teaser Figure Archetypes

Use this file only when the figure structure is unclear or the paper supports more than one plausible composition.

## Quick Selection

| Archetype | Use when | Core move | Common failure |
|---|---|---|---|
| Scenario illustration | The paper is best understood through one concrete moment of use | Show a person, place, and system effect in context | Generic scene with no mechanism |
| Transformation pipeline | The contribution is a change from input to representation to output | Make each stage visually distinct | Three boxes that all look the same |
| Paired comparison | The value is "before vs after" or "baseline vs ours" | Keep the scenario constant so the difference pops | Changing too many things at once |
| Annotated photo grid | The system guides a physical or sequential task | Use real steps and overlays | Too many tiny panels with no hierarchy |
| Scenario + architecture hybrid | The paper needs both emotional hook and mechanism | Let the scene lead and the mechanism panel explain | 50/50 split that feels like two unrelated figures |

## 1. Scenario Illustration

Use for wearables, embodied AI, AR/VR, ambient systems, collaborative interfaces, and other work where seeing the system in action matters.

Must show:
- one specific person or actor
- one specific place
- the exact objects or UI elements the system reasons about
- a visible system effect such as highlighting, recommendation, correction, or transformation

Prefer:
- one scene with one focal point
- real screenshots or grounded UI fragments if available
- overlays embedded in the scene instead of a detached legend

## 2. Transformation Pipeline

Use when the paper teaches readers by showing how something changes form.

Must show:
- raw input in its native visual format
- one or two intermediate representations
- a final output or action

Prefer:
- a different visual language for each stage
- arrows or flow that imply process without clutter
- short text overlays added later in post-production

## 3. Paired Comparison

Use when the figure's job is to prove the new method is better than the old one.

Must show:
- the same task or scenario on both sides
- the key difference in system behavior
- one visible improvement signal such as fewer steps, clearer output, or less error

Prefer:
- identical framing between panels
- one concise result badge or outcome panel
- a very obvious contrast rather than many subtle ones

## 4. Annotated Photo Grid

Use when the system guides or interprets a multi-step real-world task.

Must show:
- step order
- one overlay type per step or cue type
- enough context in each image to understand the action

Prefer:
- 3-6 panels, not 8-12 unless the user explicitly needs that density
- numbered steps
- one repeated visual vocabulary for highlights, gestures, timers, or warnings

## 5. Scenario + Architecture Hybrid

Use this as the default for many HCI systems papers that need both a hook and a mechanism.

Recommended pattern:
- let the scene occupy most of the figure
- place the mechanism panel as a supporting band or sidebar
- connect scene elements to the mechanism with a few deliberate visual links
- place the "punchline" output near the boundary between scene and explanation

Guardrails:
- one accent color for the key insight
- one dominant scene, not two competing centers
- no generic gears, network blobs, or sci-fi HUD motifs

## Composition Rules That Usually Hold

- One paper, one remembered sentence.
- One figure, one dominant focal point.
- One accent color, used sparingly.
- Fewer larger containers beat many tiny ones.
- Text should be planned separately from generated imagery.
