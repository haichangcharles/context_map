# Contextify Data Model (Rigorous ERD)

This document describes the current Supabase schema in a rigorous format, including:

- table-level entities and key fields
- implemented keys/indexes in SQL
- logical relationships used by the application
- recommended FK constraints for stronger integrity

Source of truth: [`docs/supabase.md`](./supabase.md).

## ER Diagram (Full)

```mermaid
erDiagram
    CHAT_HISTORY {
        text message_id PK
        text user_id
        text project_id
        text project_title
        text parent_id
        text branch_id
        text role
        text content
        timestamptz message_timestamp
        timestamptz captured_at
    }

    PATTERNS {
        text pattern_id PK
        text user_id
        text type
        text name
        boolean requires_human_review
        text instruction
        text example
        text review_status
        text source_from_node_id
        text source_to_node_id
        timestamptz created_at
        timestamptz updated_at
        text created_from_project_id
        boolean is_deleted
        timestamptz captured_at
    }

    BRANCH_FEEDBACK {
        text sample_id PK
        text user_id
        text current_tldr
        jsonb visible_context
        jsonb history_last_3_qa
        jsonb current_node
        integer level
        text user_behaviour
        text behaviour_source
        timestamptz time
        timestamptz captured_at
    }

    STRUCTURE_SUGGESTION_FEEDBACK {
        text event_id PK
        text suggestion_id
        text user_id
        text project_id
        text base_path
        text target_node_id
        text suggestion_kind
        text origin_kind
        text decision
        text current_tldr
        jsonb visible_context
        jsonb history_last_3_qa
        jsonb current_node
        jsonb suggestion_payload
        timestamptz shown_at
        timestamptz decided_at
        timestamptz captured_at
    }

    %% explicit PK-backed self reference (logical in current SQL)
    CHAT_HISTORY ||--o{ CHAT_HISTORY : "parent_id -> message_id"

    %% message lineage / extraction lineage (logical in current SQL)
    CHAT_HISTORY ||--o{ PATTERNS : "source_from_node_id -> message_id"
    CHAT_HISTORY ||--o{ PATTERNS : "source_to_node_id -> message_id"
    CHAT_HISTORY ||--o{ STRUCTURE_SUGGESTION_FEEDBACK : "target_node_id -> message_id (nullable)"

    %% project and user dimensions (logical in current SQL)
    CHAT_HISTORY ||--o{ PATTERNS : "project_id <-> created_from_project_id"
    CHAT_HISTORY ||--o{ BRANCH_FEEDBACK : "user_id"
    CHAT_HISTORY ||--o{ STRUCTURE_SUGGESTION_FEEDBACK : "user_id + project_id"
```

## Implemented Constraints (Current)

- **Primary keys**
  - `chat_history.message_id`
  - `patterns.pattern_id`
  - `branch_feedback.sample_id`
  - `structure_suggestion_feedback.event_id`
- **Secondary indexes**
  - `structure_suggestion_feedback_user_id_idx (user_id)`
  - `structure_suggestion_feedback_suggestion_id_idx (suggestion_id)`
  - `structure_suggestion_feedback_shown_at_idx (shown_at desc)`
- **RLS enabled** on all four tables.

## Logical Relationships Used by App

These relations are used by application logic but are not currently enforced as DB foreign keys:

- `chat_history.parent_id` references `chat_history.message_id` (thread tree)
- `patterns.source_from_node_id` references `chat_history.message_id`
- `patterns.source_to_node_id` references `chat_history.message_id`
- `patterns.created_from_project_id` aligns with `chat_history.project_id`
- `structure_suggestion_feedback.target_node_id` references `chat_history.message_id` (nullable)
- `branch_feedback.user_id` and `structure_suggestion_feedback.user_id` align with `chat_history.user_id`

## Recommended FK Hardening (Optional, Production-Oriented)

If you want stricter integrity for production, consider:

1. Add self-FK on `chat_history.parent_id -> chat_history.message_id` (`ON DELETE SET NULL`).
2. Add FKs from `patterns.source_from_node_id/source_to_node_id -> chat_history.message_id`.
3. Add FK from `structure_suggestion_feedback.target_node_id -> chat_history.message_id`.
4. Introduce canonical dimension tables (e.g., `users`, `projects`) and move `user_id/project_id` to explicit FKs.
5. Add supporting indexes for high-frequency joins:
   - `chat_history(user_id, project_id, message_timestamp)`
   - `patterns(user_id, created_from_project_id, created_at)`
   - `branch_feedback(user_id, time)`

## Notes

- Current schema is consistent with a research/prototype workflow and emphasizes logging flexibility.
- The ERD above intentionally distinguishes implemented keys from logical links, so the model stays rigorous without over-claiming constraints that are not yet in SQL.
