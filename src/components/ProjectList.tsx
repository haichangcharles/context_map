import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { SendHorizontal, Folder, Trash2, TriangleAlert, Pencil, MoreHorizontal } from 'lucide-react';
import clsx from 'clsx';

export default function ProjectList() {
  const { projects, activeProjectId, createProject, setActiveProject, renameProject, deleteProject } = useAppStore();
  const [newTitle, setNewTitle] = useState('');
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [menuOpenProjectId, setMenuOpenProjectId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const projectList = Object.values(projects);
  const pendingDeleteProject = pendingDeleteProjectId ? projects[pendingDeleteProjectId] : null;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTitle.trim()) {
      createProject(newTitle.trim());
      setNewTitle('');
    }
  };

  const startEditing = (projectId: string, currentTitle: string) => {
    setMenuOpenProjectId(null);
    setEditingProjectId(projectId);
    setEditingTitle(currentTitle);
  };

  const commitRename = () => {
    if (!editingProjectId) return;
    const trimmed = editingTitle.trim();
    if (trimmed && trimmed !== projects[editingProjectId]?.title) {
      renameProject(editingProjectId, trimmed);
    }
    setEditingProjectId(null);
    setEditingTitle('');
  };

  const cancelEditing = () => {
    setEditingProjectId(null);
    setEditingTitle('');
  };

  useEffect(() => {
    if (editingProjectId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingProjectId]);

  useEffect(() => {
    if (!menuOpenProjectId) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as HTMLElement)) {
        setMenuOpenProjectId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpenProjectId]);

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
        <span>Projects</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
        {projectList.map((project) => {
          const isActive = activeProjectId === project.project_id;
          const isEditing = editingProjectId === project.project_id;
          const isMenuOpen = menuOpenProjectId === project.project_id;

          return (
            <div
              key={project.project_id}
              role="button"
              tabIndex={0}
              className={clsx(
                "relative w-full text-left flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer group transition-all border focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30",
                isActive
                  ? "bg-zinc-900 text-white border-zinc-900 shadow-sm"
                  : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-100 hover:border-zinc-300"
              )}
              onClick={() => {
                if (!isEditing) setActiveProject(project.project_id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (!isEditing) setActiveProject(project.project_id);
                }
              }}
              title={isEditing ? undefined : project.title}
            >
              {isEditing ? (
                <input
                  ref={editInputRef}
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelEditing();
                    }
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className={clsx(
                    "w-full text-sm font-medium bg-transparent border-b outline-none py-0",
                    isActive
                      ? "text-white border-white/50 placeholder-white/40"
                      : "text-zinc-700 border-zinc-400 placeholder-zinc-400"
                  )}
                />
              ) : (
                <span className="truncate text-sm font-medium">{project.title}</span>
              )}

              {!isEditing && (
                <div className="relative flex items-center pl-2" ref={isMenuOpen ? menuRef : undefined}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenProjectId(isMenuOpen ? null : project.project_id);
                    }}
                    className={clsx(
                      "p-1 rounded-md transition-opacity",
                      isActive
                        ? "opacity-70 hover:opacity-100 text-white/80 hover:text-white"
                        : "opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-600",
                      isMenuOpen && "!opacity-100"
                    )}
                    title="Options"
                  >
                    <MoreHorizontal size={16} />
                  </button>

                  {isMenuOpen && (
                    <div
                      className="absolute right-0 top-full mt-1 z-50 w-40 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg shadow-zinc-900/10"
                      style={{ color: '#18181b' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-zinc-100 transition-colors"
                        style={{ color: '#18181b' }}
                        onClick={() => startEditing(project.project_id, project.title)}
                      >
                        <Pencil size={14} style={{ color: '#18181b' }} />
                        Rename
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-red-50 transition-colors"
                        style={{ color: '#dc2626' }}
                        onClick={() => {
                          setMenuOpenProjectId(null);
                          setPendingDeleteProjectId(project.project_id);
                        }}
                      >
                        <Trash2 size={14} style={{ color: '#dc2626' }} />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
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
            className="h-11 w-11 shrink-0 flex items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed"
            style={newTitle.trim() ? { backgroundColor: '#18181b', color: '#fff' } : { backgroundColor: '#d4d4d8', color: '#52525b' }}
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
                    This will delete &ldquo;{pendingDeleteProject.title}&rdquo;.
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
