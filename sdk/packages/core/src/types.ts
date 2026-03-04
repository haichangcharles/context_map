export type Role = 'user' | 'assistant' | 'system';

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
  status: 'active' | 'inactive';
  mainline_summary?: string;
}

export interface ContextView {
  context_id: string;
  project_id: string;
  base_path: 'mainline' | string;
  included_nodes: string[];
  excluded_nodes: string[];
  active_pattern: string | null;
  active_step_index?: number;
}

export interface Pattern {
  pattern_id: string;
  name: string;
  source_line: {
    from: string;
    to: string;
  };
  guidance_text: string;
  steps: string[];
}

export interface ContextMapState {
  projects: Record<string, Project>;
  nodes: Record<string, Node>;
  branches: Record<string, Branch>;
  mainlines: Record<string, string[]>;
  contexts: Record<string, ContextView>;
  patterns: Record<string, Pattern>;
  activeProjectId: string | null;
}

export interface AddNodeInput {
  projectId: string;
  parentId: string | null;
  role: Role;
  content: string;
  branchId: string | null;
}
