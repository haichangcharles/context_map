# Example Briefs And Prompt Patterns

Use this file when the user wants a worked example, a reusable response structure, or an image-generation prompt pattern.

## Response Template

Use this skeleton for most requests:

```markdown
Core message:
- [What the reader should understand in 10 seconds]

Chosen archetype:
- [Archetype] because [reason]

Layout and panel plan:
- [Dominant panel]
- [Supporting panel or output region]
- [Viewer eye path]

Visual elements to include:
- [Scene, screenshots, objects, overlays, comparisons]

Text overlay plan:
- [Header]
- [3-7 short labels]
- [Optional takeaway line]

What to avoid:
- [Common pitfall 1]
- [Common pitfall 2]

Optional image prompt:
- [Only when requested]
```

## Example 1: Systems Paper Brief

### User request

"Design a teaser figure for a CHI paper about collaborative AR sensemaking on a shared tabletop."

### Good response shape

```markdown
Core message:
- Two collaborators build a shared interpretation of a tabletop dataset while the AR system highlights evidence, merges viewpoints, and surfaces conflicts.

Chosen archetype:
- Scenario + architecture hybrid because the paper needs both the social scene and the evidence-merging mechanism.

Layout and panel plan:
- Main left panel: two people standing around one tabletop projection with tablets or glasses as needed.
- Right support panel: three stacked stages showing raw evidence, merged interpretation, and surfaced conflict.
- Bottom bridge card: the system's final shared recommendation or synthesis.

Visual elements to include:
- Two distinct collaborators with different evidence fragments in front of them.
- Color-coded highlights on tabletop artifacts showing where evidence agrees or conflicts.
- A support panel that reuses those same colors to explain merge logic.

Text overlay plan:
- Header: "Shared AR Sensemaking"
- Labels: "personal evidence", "merged view", "conflict surfaced", "joint conclusion"
- Takeaway: "The system helps collaborators converge without hiding disagreement."

What to avoid:
- A generic floating AR dashboard with no tabletop context.
- Equal-sized scene and mechanism panels.
```

## Example 2: Optional Image Prompt Pattern

Only use this when the user explicitly wants an image prompt.

```text
Generate a clean flat illustration for an academic HCI paper teaser figure. No words or labels inside the image. Show [specific person or actors] in [specific place] doing [specific task]. Make the main focal point [single key system effect]. Add a supporting panel that shows [mechanism] using the same objects or colors from the scene. Leave clean empty label zones for post-production text. Use one accent color only for [key insight]. Avoid sci-fi HUD styling, generic icons, and decorative clutter. Keep the figure suitable for an editable paper figure rather than a marketing poster.
```

## Example 3: When To Skip Image Generation

Skip the image-prompt path and stay in editable-figure mode when:
- the user already has strong screenshots or photos
- the contribution is best shown with exact UI states
- the paper needs precise labels, measurements, or annotations
- the venue style rewards credibility more than spectacle
