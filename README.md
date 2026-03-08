<div align="center">
  <img width="1200" height="475" alt="Context Map Banner" src="./assets/banner.svg" />
</div>

# Context Map

A prototype conversational operating layer for AI teams.
It upgrades linear chat into a visual mainline/branch workflow so complex tasks stay traceable, reviewable, and reusable.

## 1. Product Positioning

- Product form: Web SaaS prototype (currently a local MVP)
- Core problem: Long AI conversations drift, making context hard to control and decisions hard to replay
- Target users: AI application teams (PMs, prompt engineers, developers)
- Target users: Content and consulting teams that need parallel exploration + synthesis
- Core value: Explore in parallel with mainline and branches without losing context
- Core value: Node-level context controls (`Include` / `Exclude`)
- Core value: Turn high-quality conversations into reusable SOP patterns

## 2. Core Capabilities

- Multi-project management: create, switch, delete
- Conversation + graph linkage: `Projects` + `Conversation Stream` + `Context Map`
- Mainline/branch operations: `Re-Branch`, `Promote`, and custom mainline start/end
- Context orchestration: node include/exclude and batch context operations
- Structure governance: `Undo / Redo` and `Reset to Natural`
- Layout modes: `Tree` / `Mindmap` / `Timeline`
- AI enhancements: streaming responses, branch summary, and SOP extraction (`name / guidance / steps`)

## 3. Typical Use Cases

- Solution reviews: run multiple technical branches and promote the winning path
- Sales playbooks: fork messaging strategies and keep the best conversion path
- Research collaboration: split evidence/counter-evidence/conclusion into branches and merge into an auditable result

## 4. Technical Stack

- Frontend: React 19 + TypeScript + Vite
- State management: Zustand
- Graph engine: React Flow (`@xyflow/react`) + Dagre auto-layout
- AI interface: OpenAI-compatible chat completions (default setup targets SiliconFlow/DeepSeek)
- UI: TailwindCSS 4 + Lucide icons

## 5. Quick Start

### 5.1 Requirements

- Node.js 20+
- npm 9+

### 5.2 Install and Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

Default app URL: `http://localhost:3000`

## 6. Environment Variables

Configure `.env.local` (see [.env.example](.env.example)):

```bash
# Required (server-side only, do NOT use VITE_ prefix)
SILICONFLOW_API_KEY=...
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
DEEPSEEK_MODEL=deepseek-ai/DeepSeek-V3.2

# Backup provider
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.siliconflow.cn/v1
OPENAI_MODEL=deepseek-ai/DeepSeek-V3.2

# Optional default provider (auto/siliconflow/openai)
DEFAULT_MODEL_PROVIDER=auto

# Optional search provider
TAVILY_API_KEY=...

# Optional Supabase sync for chat history
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Notes:
- In `auto` mode, the app checks `SILICONFLOW_API_KEY` first, then falls back to `OPENAI_API_KEY`
- You can switch provider at runtime in `/manage` (Auto / SiliconFlow / OpenAI)
- You can set OpenAI model override at runtime in `/manage` (stored in browser localStorage)
- Model API keys are used only in serverless API (`/api/chat/completions`), not exposed in frontend bundle
- If Supabase env vars are not provided, chat history and patterns are still stored locally and queued for later sync
- App state (`projects/nodes/branches/context/patterns`) is persisted in browser `localStorage` (`context-map.app-state.v1`)
- Chat history local keys: `context-map.chat-history.by-user.v1`, `context-map.chat-history.pending-sync.v1`
- Pattern local keys: `context-map.pattern-history.by-user.v1`, `context-map.pattern-history.pending-sync.v1`
- Supabase sync auto-retries on app start, every 15s, when tab becomes visible, and when network comes back online

### 6.1 Supabase Table (Optional, for user study logging)

Run this SQL in Supabase:

```sql
create table if not exists public.chat_history (
  message_id text primary key,
  user_id text not null,
  project_id text not null,
  project_title text null,
  parent_id text null,
  branch_id text null,
  role text not null,
  content text not null default '',
  message_timestamp timestamptz not null,
  captured_at timestamptz not null default now()
);

alter table public.chat_history enable row level security;

create policy "allow anon insert chat history"
on public.chat_history
for insert
to anon
with check (true);
```

If you already created the table before this change, run:

```sql
alter table public.chat_history
add column if not exists project_title text null;
```

Also create the pattern sync table:

```sql
create table if not exists public.patterns (
  pattern_id text primary key,
  user_id text not null,
  type text not null,
  name text not null,
  requires_human_review boolean not null default false,
  instruction text not null default '',
  example text not null default '',
  review_status text not null default 'pending',
  source_from_node_id text not null,
  source_to_node_id text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_from_project_id text null,
  is_deleted boolean not null default false,
  captured_at timestamptz not null default now()
);

alter table public.patterns enable row level security;

create policy "allow anon upsert patterns"
on public.patterns
for insert
to anon
with check (true);

create policy "allow anon select patterns"
on public.patterns
for select
to anon
using (true);
```

The app stores messages and patterns in `localStorage` first, then upserts to Supabase when network/env is available.

## 7. Common Scripts

```bash
npm run dev            # local development
npm run build          # production build
npm run preview        # preview build output
npm run lint           # TypeScript check
npm run test:mainline  # mainline endpoint and structure regression tests
```

For Vercel deployment, set the model env vars in Vercel Project Settings -> Environment Variables.
To run serverless `/api/chat/completions` locally, use `vercel dev`.

## 8. Status and Roadmap

### Current MVP Status

- Core interaction loop is complete: mainline/branch/context orchestration/structure rollback/pattern extraction
- Structural stability script available: `scripts/test-mainline-endpoints.ts`

### Next Phase

- Team collaboration: multi-user sessions, comments, permissions
- Persistence: history, version snapshots, workspace isolation
- Observability: token/cost/quality dashboards
- Enterprise: SSO, audit logs, private deployment

## 9. Project Structure

```text
src/
  components/
    ConversationStream.tsx
    ContextMap.tsx
    ProjectList.tsx
  services/
    gemini.ts
  store.ts
  types.ts
scripts/
  test-mainline-endpoints.ts
sdk/
  README.md
  docs/
  packages/
```

## 10. SDK Workspace

If you want to embed Context Map as a reusable capability in third-party products, start here:

- [sdk/README.md](./sdk/README.md)
- [sdk/docs/sdk-roadmap.md](./sdk/docs/sdk-roadmap.md)

## 11. License

Apache-2.0.
