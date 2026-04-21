# Deployment and Advanced Configuration

## Environment Variables

Configure `.env.local`:

```bash
# Required (server-side only, do NOT use VITE_ prefix)
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.3-chat-latest

# Optional SiliconFlow fallback
SILICONFLOW_API_KEY=
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
DEEPSEEK_MODEL=deepseek-ai/DeepSeek-V3.2

# Optional Gemini provider (currently used by the structure suggestion agent)
GEMINI_API_KEY=...
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_MODEL=gemini-3-flash-preview

# Optional default provider (auto/siliconflow/openai/gemini)
DEFAULT_MODEL_PROVIDER=openai

# Optional search provider
TAVILY_API_KEY=...

# Optional Supabase sync for chat history
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Notes

- In `auto` mode, the app checks `SILICONFLOW_API_KEY` first, then falls back to `OPENAI_API_KEY`.
- You can switch provider at runtime in `/manage` (Auto / SiliconFlow / OpenAI).
- You can set OpenAI model override at runtime in `/manage` (stored in browser localStorage).
- Structure suggestions use `GEMINI_API_KEY` / `GEMINI_MODEL` when available, without changing the main chat provider.
- Model API keys are used only in serverless API (`/api/chat/completions`), not exposed in frontend bundle.
- If Supabase env vars are not provided, chat history, patterns, branch feedback, and structure-suggestion feedback are stored locally and queued for sync.
- App state (`projects/nodes/branches/context/patterns`) is persisted in browser `localStorage` (`context-map.app-state.v1`).
- Supabase sync auto-retries on app start, every 15s, when tab becomes visible, and when network comes back online.

## Vercel

- Set model env vars in Vercel Project Settings -> Environment Variables.
- To run serverless `/api/chat/completions` locally, use `vercel dev`.
