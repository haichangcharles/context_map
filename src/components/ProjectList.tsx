import { useState } from 'react';
import { useAppStore } from '../store';
import { SendHorizontal, Folder, Trash2 } from 'lucide-react';
import clsx from 'clsx';

export default function ProjectList() {
  const { projects, activeProjectId, createProject, setActiveProject, deleteProject } = useAppStore();
  const [newTitle, setNewTitle] = useState('');
  const projectList = Object.values(projects);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTitle.trim()) {
      createProject(newTitle.trim());
      setNewTitle('');
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-50">
      <div className="px-4 py-3 font-semibold text-zinc-800 border-b border-zinc-200 flex items-center gap-2">
        <Folder size={18} />
        Projects
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
        {projectList.map((project) => (
          <div
            key={project.project_id}
            role="button"
            tabIndex={0}
            className={clsx(
              "w-full text-left flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer group transition-all border focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30",
              activeProjectId === project.project_id
                ? "bg-zinc-900 text-white border-zinc-900 shadow-sm"
                : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-100 hover:border-zinc-300"
            )}
            onClick={() => setActiveProject(project.project_id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setActiveProject(project.project_id);
              }
            }}
            title={project.title}
          >
            <span className="truncate text-sm font-medium">{project.title}</span>
            <span className="flex items-center pl-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteProject(project.project_id);
                }}
                className={clsx(
                  "p-1 rounded-md transition-opacity",
                  activeProjectId === project.project_id
                    ? "opacity-70 hover:opacity-100 text-white/80 hover:text-red-300"
                    : "opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500"
                )}
                title="Delete Project"
              >
                <Trash2 size={14} />
              </button>
            </span>
          </div>
        ))}
        {projectList.length === 0 && (
          <div className="text-sm text-zinc-400 text-center py-6 px-3 rounded-xl bg-white border border-zinc-200">
            No projects yet
          </div>
        )}
      </div>

      <div className="pl-3 pr-4 py-3 border-t border-zinc-200 bg-white">
        <form onSubmit={handleCreate} className="flex items-center gap-2 min-w-0">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="New project"
            className="flex-1 min-w-0 px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900/20 focus:border-zinc-400 bg-zinc-50"
          />
          <button
            type="submit"
            disabled={!newTitle.trim()}
            className="h-11 w-11 shrink-0 flex items-center justify-center bg-zinc-900 text-white rounded-lg transition-colors hover:bg-zinc-800 disabled:bg-zinc-300 disabled:text-zinc-600 disabled:cursor-not-allowed"
            title="Create Project"
          >
            <SendHorizontal size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}
