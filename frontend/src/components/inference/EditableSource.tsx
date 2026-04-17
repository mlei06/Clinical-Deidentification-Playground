import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Check, X } from 'lucide-react';

interface EditableSourceProps {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

/**
 * Plain textarea editor for the source text. Swaps in for ``SpanHighlighter``
 * when the user enters edit mode on a run's original text. Committing clears
 * the current detections since the offsets no longer apply.
 */
export default function EditableSource({
  value,
  onChange,
  onCommit,
  onCancel,
}: EditableSourceProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onCommit();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        placeholder="Paste or type clinical text..."
        className="min-h-[200px] flex-1 resize-none rounded-lg border border-gray-300 p-3 font-mono text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] text-gray-400">
          Saving clears the current detections. Re-run the pipeline to annotate.
          <span className="ml-2 font-mono text-gray-400">⌘/Ctrl+Enter</span> save ·{' '}
          <span className="font-mono text-gray-400">Esc</span> cancel
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <X size={12} />
            Cancel
          </button>
          <button
            type="button"
            onClick={onCommit}
            className="inline-flex items-center gap-1 rounded bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-800"
          >
            <Check size={12} />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
