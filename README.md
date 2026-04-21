<div align="center">

<img width="1200" height="475" alt="Contextify product banner" src="./assets/banner.svg" />

# Contextify

**Open-source human–AI workspace where conversation context is explicit, structured, and manipulable.**

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Paper arXiv](https://img.shields.io/badge/paper-arXiv%202604.07121-b31b1b?logo=arxiv&logoColor=white)](https://arxiv.org/abs/2604.07121)
[![Demo video](https://img.shields.io/badge/demo-YouTube-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/watch?v=x7ZAZX5cLYg)

[Quick start](#quick-start) · [Documentation](#documentation) · [Cite the paper](#cite-the-paper) · [Contribute](#contribute)

</div>

---

## What this repository is (name change)

| Name | Meaning |
|------|---------|
| **Contextify** | The **product and open-source project** this README describes (what we ship and iterate on in public). |
| **Context Map** | The **right-hand structured view** inside the app (topology of mainline/branches and node operations). |

Earlier revisions of this README only referred to “Context Map” as the project name. The README you are reading now is intentionally framed around **Contextify** as the public product, while keeping the in-app “Context Map” terminology where the UI uses it.

---

## Why Contextify exists (paper-aligned)

Multi-turn collaboration context is often **flattened into a single chronological sequence** and passed forward as a fixed whole, which makes it hard to **dynamically organize** what should matter for the next step. Contextify explores the **Mixed-Initiative Context** idea: treat accumulated context as something **humans and the model can structure together**—branch, bound, include/exclude, and reuse—instead of only repairing it through new prompts.

Research paper: [Mixed-Initiative Context: Structuring and Managing Context for Human-AI Collaboration](https://arxiv.org/abs/2604.07121) (Haichang Li, Qinshi Zhang, Piaohong Wang, Zhicong Lu).  
Also indexed on alphaXiv: [overview](https://www.alphaxiv.org/overview/2604.07121v1).

---

## Concept and System Figures

### Mixed-Initiative Context Concept

![Mixed-Initiative Context concept figure](./asset/figs/mic.png)

### Contextify UI Overview

![Contextify UI overview](./asset/figs/UI.png)

For full details, see the paper: [arXiv:2604.07121](https://arxiv.org/abs/2604.07121).

---

## TL;DR

| You get | In practice |
|--------|-------------|
| Structured threads | Mainline + **branches** instead of one undifferentiated transcript |
| Scoped reasoning | **Include / Exclude** at node level so irrelevant turns do not pollute the next reply |
| Convergence | **Promote** a branch outcome back to the main line of work |
| Reuse | **Pattern / SOP-style extraction** from successful flows |
| Demo | **Watch:** [YouTube demo](https://www.youtube.com/watch?v=x7ZAZX5cLYg) · **Run locally** below |

---

## Quick start

**Requirements:** Node.js 20+, npm 9+

```bash
npm install
cp .env.example .env.local
# Edit .env.local: set at least OPENAI_API_KEY
npm run dev
```

Open **`http://localhost:3000`**.

For all providers, Supabase sync, and deployment: [docs/deployment.md](./docs/deployment.md) · [docs/supabase.md](./docs/supabase.md).

---

## Common scripts

```bash
npm run dev            # local dev
npm run build          # production build
npm run preview       # preview build
npm run lint          # TypeScript check
npm run test:mainline # mainline / structure regression script
```

---

## Capabilities (high level)

- **Projects** + **Conversation Stream** + **Context Map** stay in sync
- **Branch / Re-Branch / Promote**, custom mainline start/end
- **Context controls:** per-node include/exclude and batch operations
- **Structure governance:** Undo / Redo, Reset to Natural
- **Layouts:** Canvas / Map / Thread
- **AI:** streaming chat, branch summary, pattern / SOP extraction fields (`name` / guidance / steps)

---

## Stack

React 19 · TypeScript · Vite · Zustand · `@xyflow/react` + Dagre · Tailwind CSS 4 · OpenAI-compatible chat API (see `.env.example`)

---

## Documentation

| Doc | Purpose |
|-----|---------|
| [docs/deployment.md](./docs/deployment.md) | Env vars, providers, Vercel, `vercel dev` |
| [docs/supabase.md](./docs/supabase.md) | Optional Supabase tables for sync / study logging |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | How to contribute |
| [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) | Community expectations |
| [SECURITY.md](./SECURITY.md) | Reporting security issues |
| [sdk/README.md](./sdk/README.md) | SDK workspace for embedding capabilities |

---

## Status & roadmap

**Today:** MVP loop is usable end-to-end (mainline/branches, context controls, rollback, pattern extraction). Regression script: `scripts/test-mainline-endpoints.ts`.

**On the roadmap (non-exhaustive):**

- Multi-user collaboration, richer persistence, observability, enterprise-style deployment
- **Continual learning:** turn accept/reject (and related) structure-level signals into training supervision
- **Inference integration:** explore wiring the Context Map with **KV cache**-aware serving
- **OpenCode:** explore porting this interaction model into **OpenCode**-style coding workflows

---

## Cite the paper

If Contextify or the Mixed-Initiative Context idea helps your work, please cite:

```bibtex
@article{li2026mixed,
  title={Mixed-Initiative Context: Structuring and Managing Context for Human-AI Collaboration},
  author={Li, Haichang and Zhang, Qinshi and Wang, Piaohong and Lu, Zhicong},
  journal={arXiv preprint arXiv:2604.07121},
  year={2026}
}
```

---

## Contribute

Issues and PRs are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

[Apache-2.0](./LICENSE).
