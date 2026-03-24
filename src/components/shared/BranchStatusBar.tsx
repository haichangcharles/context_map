import { ArrowUpCircle, CornerUpLeft, GitBranch } from 'lucide-react';

type Props = {
  anchorPreview: string;
  canReturnParent: boolean;
  onReturnMainline: () => void;
  onReturnParent?: () => void;
  onPromote?: () => void;
};

export default function BranchStatusBar({
  anchorPreview,
  canReturnParent,
  onReturnMainline,
  onReturnParent,
  onPromote,
}: Props) {
  return (
    <div className="bg-indigo-50 border-b border-indigo-100 p-3 flex items-center justify-between shadow-sm z-10 gap-3">
      <div className="flex items-center gap-2 text-indigo-800 font-medium text-sm min-w-0">
        <GitBranch size={16} />
        <span>Subtask Active</span>
        <span className="text-indigo-500 text-xs ml-2 truncate max-w-[200px]">
          Branched from {anchorPreview}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onReturnMainline}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-100 hover:bg-indigo-200 rounded-md transition-colors"
        >
          <CornerUpLeft size={14} />
          Return to Mainline
        </button>
        {canReturnParent && onReturnParent && (
          <button
            onClick={onReturnParent}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-white border border-indigo-200 hover:bg-indigo-50 rounded-md transition-colors"
          >
            <CornerUpLeft size={14} />
            Return to Parent
          </button>
        )}
        {onPromote && (
          <button
            onClick={onPromote}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors"
          >
            <ArrowUpCircle size={14} />
            Promote Branch
          </button>
        )}
      </div>
    </div>
  );
}
