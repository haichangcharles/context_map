import clsx from 'clsx';
import { MousePointerSquareDashed, Rows3, Search, Trash2, X } from 'lucide-react';

type Props = {
  searchContent?: React.ReactNode;
  iconOnlyToolstrip?: boolean;
  isSelectionMode: boolean;
  selectionIntent: 'batch' | 'delete' | null;
  isSearchActive?: boolean;
  onToggleSearch: () => void;
  onToggleSelectionMode: () => void;
  onRearrange: () => void;
  onToggleDeleteMode: () => void;
};

const SELECTION_ACTIVE_SURFACE = 'bg-[#3a3a3c] border-[#3a3a3c] text-white';
const DELETE_ACTIVE_SURFACE = 'bg-rose-600 border-rose-600 text-white';

export default function ContextMapModeStrip({
  searchContent,
  iconOnlyToolstrip = false,
  isSelectionMode,
  selectionIntent,
  isSearchActive = false,
  onToggleSearch,
  onToggleSelectionMode,
  onRearrange,
  onToggleDeleteMode,
}: Props) {
  return (
    <div className="flex overflow-hidden rounded-[0.95rem] border border-zinc-200 bg-white/95 shadow-[0_12px_28px_rgba(15,23,42,0.1)] backdrop-blur-xl">
      {searchContent ?? (
        <button
          type="button"
          onClick={onToggleSearch}
          className={clsx(
            'flex h-10 items-center justify-center gap-1.5 border-r border-zinc-200 px-3 text-[11px] font-medium transition-colors',
            iconOnlyToolstrip ? 'w-10' : 'min-w-[5.5rem]',
            isSearchActive ? 'bg-amber-50 text-amber-700' : 'bg-white text-zinc-700 hover:bg-zinc-100'
          )}
          title="Search nodes"
        >
          <Search size={13} />
          {!iconOnlyToolstrip && <span>Search</span>}
        </button>
      )}
      <button
        onClick={onToggleSelectionMode}
        className={clsx(
          'flex h-10 items-center justify-center gap-1.5 border-r border-zinc-200 px-3 text-[11px] font-medium transition-colors',
          iconOnlyToolstrip ? 'w-10' : 'min-w-[7rem]',
          isSelectionMode && selectionIntent === 'batch'
            ? SELECTION_ACTIVE_SURFACE
            : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100'
        )}
        title={isSelectionMode ? 'Finish node selection mode' : 'Start selecting nodes for batch actions'}
      >
        {isSelectionMode && selectionIntent === 'batch' ? <X size={13} className="!text-white" /> : <MousePointerSquareDashed size={13} className="text-inherit" />}
        {!iconOnlyToolstrip && (
          <span className={clsx(isSelectionMode && selectionIntent === 'batch' && '!text-white')}>
            {isSelectionMode && selectionIntent === 'batch' ? 'Finish' : 'Selection'}
          </span>
        )}
      </button>
      <button
        onClick={onRearrange}
        className={clsx(
          'flex h-10 items-center justify-center gap-1.5 border-r border-zinc-200 px-3 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100',
          iconOnlyToolstrip ? 'w-10' : 'min-w-[7.5rem]'
        )}
        title="Rearrange and center mainline"
      >
        <Rows3 size={13} />
        {!iconOnlyToolstrip && <span>Rearrange</span>}
      </button>
      <button
        onClick={onToggleDeleteMode}
        className={clsx(
          'flex h-10 items-center justify-center gap-1.5 px-3 text-[11px] font-medium transition-colors',
          iconOnlyToolstrip ? 'w-10' : 'min-w-[6.5rem]',
          isSelectionMode && selectionIntent === 'delete'
            ? DELETE_ACTIVE_SURFACE
            : 'text-rose-700 border-rose-200 bg-rose-50 hover:bg-rose-100'
        )}
        title={isSelectionMode && selectionIntent === 'delete' ? 'Finish delete selection mode' : 'Start delete selection mode'}
      >
        {isSelectionMode && selectionIntent === 'delete' ? <X size={13} className="!text-white" /> : <Trash2 size={13} />}
        {!iconOnlyToolstrip && <span>{isSelectionMode && selectionIntent === 'delete' ? 'Finish' : 'Delete'}</span>}
      </button>
    </div>
  );
}
