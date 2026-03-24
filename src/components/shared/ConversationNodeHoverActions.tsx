import { Eye, EyeOff, GitBranch, Pencil } from 'lucide-react';

type Props = {
  isSelectionActive: boolean;
  isExcluded: boolean;
  canEdit?: boolean;
  onBranch: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleContext: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onEdit?: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

export default function ConversationNodeHoverActions({
  isSelectionActive,
  isExcluded,
  canEdit = true,
  onBranch,
  onToggleContext,
  onEdit,
}: Props) {
  if (isSelectionActive) return null;

  return (
    <>
      <button
        onClick={onBranch}
        className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-indigo-600 transition-all text-xs flex items-center gap-1"
        title="Re-Branch from Here"
      >
        <GitBranch size={12} />
        Branch
      </button>
      <button
        onClick={onToggleContext}
        className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 transition-all text-xs flex items-center gap-1"
        title="Cycle context state"
      >
        {isExcluded ? <Eye size={12} /> : <EyeOff size={12} />}
        Context
      </button>
      {canEdit && onEdit && (
        <button
          onClick={onEdit}
          className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-amber-600 transition-all text-xs flex items-center gap-1"
          title="Edit message"
        >
          <Pencil size={12} />
          Edit
        </button>
      )}
    </>
  );
}
