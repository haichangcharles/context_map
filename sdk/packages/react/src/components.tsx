import React, { useState } from 'react';
import { useContextMapEngine, useContextMapState } from './provider';
import type { ContextMapPanelProps } from './types';

export function ContextMapPanel({ className, state, onCreateProject }: ContextMapPanelProps) {
  const engine = useContextMapEngine();
  const internalState = useContextMapState();
  const view = state ?? internalState;
  const [title, setTitle] = useState('');

  const activeProject = view.activeProjectId ? view.projects[view.activeProjectId] : null;
  const activeMainlineCount = activeProject ? (view.mainlines[activeProject.project_id] || []).length : 0;

  const handleCreate = () => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    if (onCreateProject) onCreateProject(nextTitle);
    else engine.createProject(nextTitle);
    setTitle('');
  };

  return (
    <section className={className}>
      <h3>Context Map SDK Panel</h3>
      <p>Projects: {Object.keys(view.projects).length}</p>
      <p>Nodes: {Object.keys(view.nodes).length}</p>
      <p>Branches: {Object.keys(view.branches).length}</p>
      <p>Active mainline nodes: {activeMainlineCount}</p>

      <div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Create project"
          aria-label="Create project"
        />
        <button type="button" onClick={handleCreate}>
          Add
        </button>
      </div>
    </section>
  );
}
