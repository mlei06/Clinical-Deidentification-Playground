import { useRef, useState } from 'react';
import { Trash2, Plus, Wand2, Loader2, RotateCcw } from 'lucide-react';
import LabelBadge from './LabelBadge';
import { CANONICAL_LABELS } from '../../lib/canonicalLabels';
import type { OutputMode, PHISpanResponse } from '../../api/types';

interface SpanEditorProps {
  originalText: string;
  spans: PHISpanResponse[];
  outputMode: OutputMode;
  onOutputModeChange: (mode: OutputMode) => void;
  onChange: (spans: PHISpanResponse[]) => void;
  onApply: () => void;
  onReset: () => void;
  isApplying: boolean;
  isDirty: boolean;
  error?: string | null;
}

function spanKey(s: PHISpanResponse): string {
  return `${s.start}-${s.end}-${s.label}`;
}

export default function SpanEditor({
  originalText,
  spans,
  outputMode,
  onOutputModeChange,
  onChange,
  onApply,
  onReset,
  isApplying,
  isDirty,
  error,
}: SpanEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [addLabel, setAddLabel] = useState<string>('OTHER');
  const [selection, setSelection] = useState<{ start: number; end: number; text: string } | null>(
    null,
  );

  const handleSelect = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart, selectionEnd } = ta;
    if (selectionStart === selectionEnd) {
      setSelection(null);
      return;
    }
    setSelection({
      start: selectionStart,
      end: selectionEnd,
      text: originalText.slice(selectionStart, selectionEnd),
    });
  };

  const handleAdd = () => {
    if (!selection) return;
    const next: PHISpanResponse = {
      start: selection.start,
      end: selection.end,
      label: addLabel,
      text: selection.text,
      confidence: null,
      source: 'manual',
    };
    if (spans.some((s) => spanKey(s) === spanKey(next))) {
      setSelection(null);
      return;
    }
    const merged = [...spans, next].sort((a, b) => a.start - b.start || a.end - b.end);
    onChange(merged);
    setSelection(null);
  };

  const handleDelete = (key: string) => {
    onChange(spans.filter((s) => spanKey(s) !== key));
  };

  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-600">Post-edit spans</span>
        <span className="text-gray-400">
          {spans.length} span{spans.length !== 1 ? 's' : ''}
        </span>
        {isDirty && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
            unsaved edits
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <select
            value={outputMode}
            onChange={(e) => onOutputModeChange(e.target.value as OutputMode)}
            className="rounded border border-gray-200 bg-white px-2 py-1 text-gray-700"
            title="Output mode for re-redaction"
          >
            <option value="redacted">Redacted tags</option>
            <option value="surrogate">Surrogate data</option>
          </select>
          <button
            type="button"
            onClick={onReset}
            disabled={!isDirty || isApplying}
            className="flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            title="Revert to the spans detected by the pipeline"
          >
            <RotateCcw size={12} />
            Reset
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={isApplying || spans.length === 0}
            className="flex items-center gap-1 rounded bg-gray-900 px-2 py-1 font-medium text-white hover:bg-gray-800 disabled:opacity-40"
            title="Re-redact the original text using the edited spans"
          >
            {isApplying ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            Apply corrections
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-red-700">
          {error}
        </div>
      )}

      {/* Selection-based add UI */}
      <div className="flex flex-col gap-1.5 rounded border border-gray-100 bg-gray-50 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-gray-500">
            Missed a PHI mention? Select it below and add it:
          </span>
          <select
            value={addLabel}
            onChange={(e) => setAddLabel(e.target.value)}
            className="rounded border border-gray-200 bg-white px-2 py-0.5 text-gray-700"
          >
            {CANONICAL_LABELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!selection}
            className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            <Plus size={12} />
            Add span
          </button>
          {selection && (
            <span className="truncate text-[11px] text-gray-500">
              "{selection.text.slice(0, 48)}
              {selection.text.length > 48 ? '...' : ''}" [{selection.start}--{selection.end}]
            </span>
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={originalText}
          readOnly
          onSelect={handleSelect}
          onMouseUp={handleSelect}
          onKeyUp={handleSelect}
          className="h-24 w-full resize-y rounded border border-gray-200 bg-white p-2 font-mono text-[11px] text-gray-800 focus:border-blue-400 focus:outline-none"
        />
      </div>

      {/* Span list */}
      {sorted.length > 0 ? (
        <ul className="max-h-56 divide-y divide-gray-100 overflow-auto rounded border border-gray-100">
          {sorted.map((s) => {
            const key = spanKey(s);
            return (
              <li key={key} className="flex items-center gap-2 px-2 py-1.5">
                <LabelBadge label={s.label} />
                <code className="min-w-0 flex-1 truncate text-[11px] text-gray-700">
                  {s.text || originalText.slice(s.start, s.end)}
                </code>
                <span className="text-[10px] text-gray-400">
                  [{s.start}--{s.end}]
                </span>
                {s.source && (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                    {s.source}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(key)}
                  className="rounded p-1 text-red-500 hover:bg-red-50"
                  title="Remove this span (false positive)"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded border border-dashed border-gray-200 px-3 py-4 text-center text-gray-400">
          No spans. Add some above, or reset to the detected spans.
        </div>
      )}
    </div>
  );
}
