export type Role = 'user' | 'assistant' | 'system';
export type PatternType = 'reasoning' | 'task_sop' | 'context_case';
export type PatternReviewStatus = 'pending' | 'approved';
export type SelectionNoticeTone = 'info' | 'success' | 'warning' | 'error';

export interface SelectionNotice {
  id: string;
  tone: SelectionNoticeTone;
  title: string;
  message: string;
  details?: string;
  defaultExpanded?: boolean;
}

export interface Project {
  project_id: string;
  title: string;
  root_node_id: string | null;
  mainline_id: string;
  active_context_id: string;
}

export interface Node {
  node_id: string;
  project_id: string;
  parent_id: string | null;
  role: Role;
  content: string;
  branch_id: string | null;
  timestamp: string;
  metadata: {
    is_anchor?: boolean;
    is_return_summary?: boolean;
    natural_origin_branch_id?: string | null;
  };
}

export interface Branch {
  branch_id: string;
  project_id: string;
  anchor_node_id: string;
  parent_branch_id: string | null;
  status: 'active' | 'inactive';
  intent_summary?: string;
  parent_context_tldr?: string;
  mainline_summary?: string;
}

export interface ContextView {
  context_id: string;
  project_id: string;
  base_path: 'mainline' | string; // 'mainline' or branch_id
  included_nodes: string[];
  excluded_nodes: string[];
  enabled_patterns_by_type: Partial<Record<PatternType, string>>;
}

export interface Pattern {
  pattern_id: string;
  type: PatternType;
  name: string;
  requires_human_review: boolean;
  instruction: string;
  example: string;
  review_status: PatternReviewStatus;
  source_line: {
    from: string;
    to: string;
  };
  created_at: string;
  updated_at: string;
  created_from_project_id?: string;
}
