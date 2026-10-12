# Deployment and Advanced Configuration

## Environment Variables

Export `SILICONFLOW_API_KEY` in the server process. Optional non-secret settings can go in `.env.local`:

```bash
# Default provider (server-side only; do NOT use VITE_ prefix)
# Export SILICONFLOW_API_KEY in the server process environment; do not commit it.
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
DEEPSEEK_MODEL=deepseek-ai/DeepSeek-V3

# Optional alternative providers, used only when explicitly selected
# OPENAI_API_KEY=...
# OPENAI_BASE_URL=https://api.openai.com/v1
# OPENAI_MODEL=...
# GEMINI_API_KEY=...
# GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
# GEMINI_MODEL=...

# Optional default provider (auto/siliconflow/openai/gemini)
DEFAULT_MODEL_PROVIDER=siliconflow

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
- Structure suggestions use the selected server-side model provider, the same budget-controlled route as chat.
- Model API keys are used only in serverless API (`/api/chat/completions`), not exposed in frontend bundle.
- If Supabase env vars are not provided, chat history, patterns, branch feedback, and structure-suggestion feedback are stored locally and queued for sync.
- App state (`projects/nodes/branches/context/patterns`) is persisted in browser `localStorage` (`context-map.app-state.v1`).
- Supabase sync auto-retries on app start, every 15s, when tab becomes visible, and when network comes back online.

## Vercel

- Set model env vars in Vercel Project Settings -> Environment Variables.
- To run serverless `/api/chat/completions` locally, use `vercel dev`.
