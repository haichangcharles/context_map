# Supabase Setup (Optional)

Run the following SQL in Supabase.

## chat_history

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

create policy "allow anon select chat history"
on public.chat_history
for select
to anon
using (true);
```

If already created:

```sql
alter table public.chat_history
add column if not exists project_title text null;
```

## patterns

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

## branch_feedback

```sql
create table if not exists public.branch_feedback (
  sample_id text primary key,
  user_id text not null,
  current_tldr text not null default '',
  visible_context jsonb not null default '[]'::jsonb,
  history_last_3_qa jsonb not null default '[]'::jsonb,
  current_node jsonb not null default '{}'::jsonb,
  level integer not null default 1,
  user_behaviour text not null,
  behaviour_source text not null,
  time timestamptz not null,
  captured_at timestamptz not null default now()
);

alter table public.branch_feedback enable row level security;

create policy "allow anon insert branch feedback"
on public.branch_feedback
for insert
to anon
with check (true);

create policy "allow anon select branch feedback"
on public.branch_feedback
for select
to anon
using (true);
```

If already created:

```sql
alter table public.branch_feedback
add column if not exists visible_context jsonb not null default '[]'::jsonb;
```

## structure_suggestion_feedback

```sql
create table if not exists public.structure_suggestion_feedback (
  event_id text primary key,
  suggestion_id text not null,
  user_id text not null,
  project_id text null,
  base_path text null,
  target_node_id text null,
  suggestion_kind text not null,
  origin_kind text not null,
  decision text not null,
  current_tldr text not null default '',
  visible_context jsonb not null default '[]'::jsonb,
  history_last_3_qa jsonb not null default '[]'::jsonb,
  current_node jsonb not null default '{}'::jsonb,
  suggestion_payload jsonb not null default '{}'::jsonb,
  shown_at timestamptz not null,
  decided_at timestamptz null,
  captured_at timestamptz not null default now()
);

create index if not exists structure_suggestion_feedback_user_id_idx
on public.structure_suggestion_feedback (user_id);

create index if not exists structure_suggestion_feedback_suggestion_id_idx
on public.structure_suggestion_feedback (suggestion_id);

create index if not exists structure_suggestion_feedback_shown_at_idx
on public.structure_suggestion_feedback (shown_at desc);

alter table public.structure_suggestion_feedback enable row level security;

create policy "allow anon insert structure suggestion feedback"
on public.structure_suggestion_feedback
for insert
to anon
with check (true);

create policy "allow anon select structure suggestion feedback"
on public.structure_suggestion_feedback
for select
to anon
using (true);
```

If already created:

```sql
alter table public.structure_suggestion_feedback
add column if not exists visible_context jsonb not null default '[]'::jsonb;
```
