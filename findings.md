# Findings

- The main server-side provider selection is implemented in `vite.config.ts` and `api/chat/completions.ts`.
- Request header `x-model-provider` overrides env defaults; if it is `auto`, the server falls back to `DEFAULT_MODEL_PROVIDER`.
- In `auto` mode, the server prefers `SILICONFLOW_API_KEY` before `OPENAI_API_KEY`, so leaving a SiliconFlow key in place can keep routing traffic there.
- Browser runtime state stores provider preference and OpenAI model override in localStorage keys:
  - `context-map.model-provider.preference`
  - `context-map.model-provider.openai-model`
- `.env.local` existed and contained active SiliconFlow and OpenAI credentials; switching to OpenAI required updating env values and neutralizing the SiliconFlow key.
- OpenAI `gpt-5.3-chat-latest` rejects `max_tokens` on chat completions and requires `max_completion_tokens`.
- Before the fix, `src/services/gemini.ts` still sent `max_tokens` in both streaming and non-streaming OpenAI-compatible requests.
- Before the fix, `api/chat/completions.ts` passed request bodies through unchanged for OpenAI-compatible providers, so unsupported parameters reached the upstream API.
- `.gitignore` already ignored `Study/` but did not ignore `paper/`.
- `paper/` contains the formal LaTeX manuscript skeleton and should be treated as the canonical paper-writing surface.
- `Study/` mixes at least four categories:
  - paper framing and working drafts
  - study design / method source material
  - IRB / RAMP compliance documents
  - superseded drafts and export artifacts
- The strongest paper-writing inputs right now are `Study/07-paper-master-framing.md`, `Study/08-paper-draft-working.md`, `Study/12-paper-bullet-points.md`, `Study/20-ramp-interaction-overview.md`, and the LaTeX files in `paper/sections/`.
