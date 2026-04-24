import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { redactDocument } from '../../api/process';
import type { EntitySpanResponse } from '../../api/types';
import type { SpanConflictSet } from '../../lib/spanOverlapConflicts';
import LabelBadge from '../shared/LabelBadge';

interface ConflictResolutionPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRect: DOMRect | null;
  originalText: string;
  conflict: SpanConflictSet | null;
  onKeep: (kept: EntitySpanResponse) => void;
  /** Drop every candidate at the conflicting range — user decided no label applies here. */
  onDropAll?: (range: { start: number; end: number }) => void;
}

export default function ConflictResolutionPopover({
  open,
  onClose,
  anchorRect,
  originalText,
  conflict,
  onKeep,
  onDropAll,
}: ConflictResolutionPopoverProps) {
  const [surrogateSnippets, setSurrogateSnippets] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !conflict) {
      setSurrogateSnippets({});
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const run = async () => {
      try {
        const entries = await Promise.all(
          conflict.spans.map(async (s) => {
            const res = await redactDocument({
              text: originalText,
              spans: [{ start: s.start, end: s.end, label: s.label }],
              output_mode: 'surrogate',
            });
            const slice = res.output_text.slice(s.start, s.end);
            return [`${s.start}-${s.end}-${s.label}`, slice] as const;
          }),
        );
        if (!cancelled) {
          setSurrogateSnippets(Object.fromEntries(entries));
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Preview failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [open, conflict, originalText]);

  if (!open || !conflict || !anchorRect) return null;

  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 420));
  const top = Math.min(anchorRect.bottom + 8, window.innerHeight - 120);

  const body = (
    <div
      className="fixed z-[100] w-[min(400px,calc(100vw-16px))] rounded-lg border border-amber-200 bg-white p-3 shadow-2xl"
      style={{ left, top }}
      role="dialog"
      aria-labelledby="conflict-popover-title"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 id="conflict-popover-title" className="text-sm font-semibold text-gray-900">
            Resolve span conflict
          </h3>
          <p className="mt-0.5 text-[11px] text-gray-500">
            <span className="font-mono text-gray-700">{conflict.text}</span>
            <span className="text-gray-400"> at </span>
            {conflict.start}–{conflict.end}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>
      <p className="mb-3 text-[11px] leading-snug text-gray-600">
        Multiple pipes assigned different labels to this exact range. Choose the label to use for
        redaction and surrogacy.
      </p>

      {loading && (
        <div className="mb-2 flex items-center gap-2 text-[11px] text-gray-500">
          <Loader2 size={12} className="animate-spin" />
          Loading surrogate previews…
        </div>
      )}
      {error && (
        <div className="mb-2 rounded border border-red-100 bg-red-50 px-2 py-1 text-[11px] text-red-700">
          {error}
        </div>
      )}

      <ul className="mb-3 space-y-2">
        {conflict.spans.map((s) => {
          const k = `${s.start}-${s.end}-${s.label}`;
          const preview = surrogateSnippets[k];
          return (
            <li
              key={k}
              className="rounded border border-gray-100 bg-gray-50/80 px-2 py-2 text-[11px]"
            >
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <LabelBadge label={s.label} />
                <span className="text-gray-500">
                  {s.source ? (
                    <>
                      Found by: <span className="font-medium text-gray-700">{s.source}</span>
                    </>
                  ) : (
                    <span className="text-gray-400">Source unknown</span>
                  )}
                </span>
              </div>
              <div className="font-mono text-[10px] text-gray-600">
                Surrogate:{' '}
                <span className="text-gray-900">
                  {preview !== undefined ? preview : loading ? '…' : '—'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onKeep(s)}
                className="mt-2 w-full rounded bg-gray-900 px-2 py-1.5 text-[11px] font-medium text-white hover:bg-gray-800"
              >
                Keep {s.label}
              </button>
            </li>
          );
        })}
      </ul>

      {onDropAll && (
        <button
          type="button"
          onClick={() => onDropAll({ start: conflict.start, end: conflict.end })}
          className="mb-2 w-full rounded border border-red-200 bg-white py-1.5 text-[11px] font-medium text-red-700 hover:bg-red-50"
          title="Remove every candidate span at this range"
        >
          Keep none — drop spans
        </button>
      )}

      <button
        type="button"
        onClick={onClose}
        className="w-full rounded border border-gray-200 py-1.5 text-[11px] text-gray-600 hover:bg-gray-50"
      >
        Cancel
      </button>
    </div>
  );

  return createPortal(body, document.body);
}
