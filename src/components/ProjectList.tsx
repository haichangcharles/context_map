import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { SendHorizontal, Folder, Trash2, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';

export default function ProjectList() {
  const { projects, activeProjectId, createProject, setActiveProject, deleteProject } = useAppStore();
  const [newTitle, setNewTitle] = useState('');
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState<string | null>(null);
  const projectList = Object.values(projects);
  const pendingDeleteProject = pendingDeleteProjectId ? projects[pendingDeleteProjectId] : null;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTitle.trim()) {
      createProject(newTitle.trim());
      setNewTitle('');
    }
  };

  useEffect(() => {
    if (!pendingDeleteProjectId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPendingDeleteProjectId(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingDeleteProjectId]);

  const handleConfirmDelete = () => {
    if (!pendingDeleteProject) {
      setPendingDeleteProjectId(null);
      return;
    }
    deleteProject(pendingDeleteProject.project_id);
    setPendingDeleteProjectId(null);
  };

  return (
    <div className="relative flex flex-col h-full bg-zinc-50">
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
                  setPendingDeleteProjectId(project.project_id);
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

      {pendingDeleteProject && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-zinc-950/16 px-4 backdrop-blur-[1px]"
          onClick={() => setPendingDeleteProjectId(null)}
        >
          <div
            className="w-full max-w-[420px] overflow-hidden rounded-[1.5rem] border border-zinc-300/80 bg-white text-zinc-900 shadow-[0_18px_36px_rgba(15,23,42,0.14)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pb-6 pt-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
                  <TriangleAlert size={16} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[1.45rem] font-medium tracking-[-0.03em] text-zinc-950">
                    Delete project?
                  </h3>
                  <p className="mt-4 text-[0.98rem] leading-7 text-zinc-900">
                    This will delete “{pendingDeleteProject.title}”.
                  </p>
                </div>
              </div>

              <div className="mt-7 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPendingDeleteProjectId(null)}
                  className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-[0.95rem] font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  className="rounded-xl border border-rose-600 bg-rose-600 px-4 py-2.5 text-[0.95rem] font-medium text-white transition-colors hover:bg-rose-700"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
