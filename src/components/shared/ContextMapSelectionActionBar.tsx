import clsx from 'clsx';
import { ArrowRightLeft, Minus, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { PatternType } from '../../types';

type BatchProps = {
  mode: 'batch';
  selectedCount: number;
  iconOnlyActionBar?: boolean;
  compactActionBar?: boolean;
  pendingPatternType: PatternType;
  isBusy?: boolean;
  onInclude: () => void;
  onExclude: () => void;
  onInvert: () => void;
  onPatternTypeChange: (next: PatternType) => void;
  onExtract: () => void;
};

type DeleteProps = {
  mode: 'delete';
  selectedCount: number;
  iconOnlyActionBar?: boolean;
  compactActionBar?: boolean;
  pendingDeletePreview: boolean;
  pendingDeleteCount?: number;
  pendingPlaceholderCount?: number;
  onDeletePreview: () => void;
  onClear: () => void;
  onCancelPreview: () => void;
  onConfirmDelete: () => void;
};

type Props = BatchProps | DeleteProps;

const PATTERN_TYPE_ORDER: PatternType[] = ['reasoning', 'task_sop', 'context_case'];
const PATTERN_TYPE_LABEL: Record<PatternType, string> = {
  reasoning: 'Reasoning',
  task_sop: 'Task SOP',
  context_case: 'Context Case',
};
const SELECTION_ACTIVE_SURFACE = 'bg-[#3a3a3c] border-[#3a3a3c] text-white';
const DELETE_ACTIVE_SURFACE = 'bg-rose-600 border-rose-600 text-white';

export default function ContextMapSelectionActionBar(props: Props) {
  if (props.selectedCount <= 0) return null;

  if (props.mode === 'batch') {
    return (
      <div className="rounded-[0.95rem] border border-zinc-200 bg-white/96 p-1.5 text-slate-900 shadow-[0_10px_22px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <div className="flex max-w-full items-center gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className={clsx('mr-1 flex h-9 items-center gap-1.5 rounded-md px-2.5', SELECTION_ACTIVE_SURFACE)}>
            <span className="text-xs font-semibold leading-none">{props.selectedCount}</span>
            {!props.iconOnlyActionBar && <span className="text-[11px] font-medium leading-none">selected</span>}
          </div>
          <button
            onClick={props.onInclude}
            disabled={props.isBusy || props.selectedCount === 0}
            className={clsx(
              'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-[11px] font-medium transition-colors',
              props.isBusy || props.selectedCount === 0
                ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100'
            )}
          >
            <Plus size={14} />
            {!props.iconOnlyActionBar && 'Include'}
          </button>
          <button
            onClick={props.onExclude}
            disabled={props.isBusy || props.selectedCount === 0}
            className={clsx(
              'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-[11px] font-medium transition-colors',
              props.isBusy || props.selectedCount === 0
                ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100'
            )}
          >
            <Minus size={14} />
            {!props.iconOnlyActionBar && 'Exclude'}
          </button>
          <button
            onClick={props.onInvert}
            disabled={props.isBusy || props.selectedCount === 0}
            className={clsx(
              'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-[11px] font-medium transition-colors',
              props.isBusy || props.selectedCount === 0
                ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100'
            )}
          >
            <ArrowRightLeft size={14} />
            {!props.iconOnlyActionBar && 'Invert'}
          </button>
          {!props.compactActionBar && <div className="mx-1 h-6 w-px bg-slate-200" />}
          <select
            value={props.pendingPatternType}
            onChange={(e) => props.onPatternTypeChange(e.target.value as PatternType)}
            disabled={props.isBusy}
            aria-label="Pattern type"
            className={clsx(
              'h-9 border border-slate-300 bg-white text-[11px] text-slate-700 outline-none',
              props.compactActionBar ? 'w-[7rem] rounded-md px-2.5' : 'rounded-md px-3'
            )}
          >
            {PATTERN_TYPE_ORDER.map((type) => (
              <option key={type} value={type}>
                {PATTERN_TYPE_LABEL[type]}
              </option>
            ))}
          </select>
          <button
            onClick={props.onExtract}
            disabled={props.isBusy || props.selectedCount === 0}
            className={clsx(
              'inline-flex h-9 items-center justify-center gap-1.5 rounded-md border px-3 text-[11px] font-medium transition-colors',
              props.isBusy || props.selectedCount === 0
                ? 'border-slate-200 bg-slate-200 text-slate-500 cursor-not-allowed'
                : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100'
            )}
          >
            <Sparkles size={14} className="text-inherit" />
            {!props.iconOnlyActionBar && <span>{props.isBusy ? 'Extracting...' : 'Extract'}</span>}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[0.95rem] border border-rose-200 bg-white/96 p-1.5 text-slate-900 shadow-[0_10px_22px_rgba(225,29,72,0.08)] backdrop-blur-xl">
      <div className="flex max-w-full items-center gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {!props.pendingDeletePreview ? (
          <>
            <div className={clsx('mr-1 flex h-9 items-center gap-1.5 rounded-md px-2.5', DELETE_ACTIVE_SURFACE)}>
              <span className="text-xs font-semibold leading-none">{props.selectedCount}</span>
              {!props.iconOnlyActionBar && <span className="text-[11px] font-medium leading-none">selected</span>}
            </div>
            <button
              onClick={props.onDeletePreview}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 text-[11px] font-medium text-rose-700 transition-colors hover:bg-rose-100"
            >
              <Trash2 size={14} />
              {!props.iconOnlyActionBar && 'Delete...'}
            </button>
            <button
              onClick={props.onClear}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
            >
              {!props.iconOnlyActionBar ? 'Clear' : <X size={14} />}
            </button>
          </>
        ) : (
          <>
            <div className="mr-1 min-w-0 px-1">
              <p className="text-[12px] font-semibold text-slate-900">
                Delete {props.pendingDeleteCount ?? props.selectedCount} node{(props.pendingDeleteCount ?? props.selectedCount) === 1 ? '' : 's'}?
              </p>
              {(props.pendingPlaceholderCount ?? 0) > 0 && (
                <p className="text-[11px] text-amber-700">
                  Insert {props.pendingPlaceholderCount} placeholder{props.pendingPlaceholderCount === 1 ? '' : 's'} to preserve branches
                </p>
              )}
            </div>
            <button
              onClick={props.onCancelPreview}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
            >
              {!props.iconOnlyActionBar ? 'Cancel' : <X size={14} />}
            </button>
            <button
              onClick={props.onConfirmDelete}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-rose-600 bg-rose-600 px-3 text-[11px] font-medium text-white transition-colors hover:bg-rose-700"
            >
              <Trash2 size={14} />
              {!props.iconOnlyActionBar && 'Confirm delete'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
