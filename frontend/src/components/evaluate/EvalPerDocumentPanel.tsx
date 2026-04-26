import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import SpanHighlighter from '../shared/SpanHighlighter';
import type {
  EntitySpanResponse,
  EvalPerDocumentItem,
  EvalSpanLite,
} from '../../api/types';

function toResponseSpans(spans: EvalSpanLite[] | undefined, text: string): EntitySpanResponse[] {
  if (!spans) return [];
  return spans.map((s) => ({
    start: s.start,
    end: s.end,
    label: s.label,
    text: text.slice(s.start, s.end),
    confidence: null,
    source: null,
  }));
}

function formatScore(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : '—';
}

interface Props {
  items: EvalPerDocumentItem[];
  truncated: boolean;
  total: number;
  includesSpans: boolean;
}

export default function EvalPerDocumentPanel({
  items,
  truncated,
  total,
  includesSpans,
}: Props) {
  const [index, setIndex] = useState(0);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setIndex(0);
  }, [items]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const selected = useMemo(() => items[index] ?? null, [items, index]);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-800">Per-document inspection</h3>
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <span>
            Showing {items.length} of {total} {truncated ? '(truncated, worst-F1 first)' : ''}
          </span>
        </div>
      </div>

      {!includesSpans && (
        <div className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          Spans were not included in this run. Re-run with detailed document span breakdown enabled.
        </div>
      )}

      {selected && includesSpans && selected.text != null && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
          >
            <ChevronLeft size={12} />
            Prev
          </button>
          <button
            type="button"
            onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}
            disabled={index >= items.length - 1}
            className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
          >
            Next
            <ChevronRight size={12} />
          </button>
          <span>
            {index + 1} / {items.length}
          </span>
          <code className="rounded bg-gray-100 px-1">{selected.document_id}</code>
          <span className="text-gray-500">
            F1 {formatScore(selected.metrics.strict?.f1 ?? 0)} · FP {selected.false_positive_count} ·
            FN {selected.false_negative_count}
          </span>
        </div>
      )}

      {selected && includesSpans && selected.text != null && (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-gray-500">
              <span>
                Gold — <code className="font-mono">{selected.document_id}</code>
              </span>
              <span className="text-amber-700">FN {selected.false_negative_count}</span>
            </div>
            <div className="max-h-80 overflow-auto rounded border border-gray-200 bg-gray-50 p-2 text-xs">
              <SpanHighlighter
                text={selected.text ?? ''}
                spans={toResponseSpans(selected.gold_spans, selected.text ?? '')}
              />
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-gray-500">
              <span>Predicted</span>
              <span className="text-rose-700">FP {selected.false_positive_count}</span>
            </div>
            <div className="max-h-80 overflow-auto rounded border border-gray-200 bg-gray-50 p-2 text-xs">
              <SpanHighlighter
                text={selected.text ?? ''}
                spans={toResponseSpans(selected.pred_spans, selected.text ?? '')}
              />
            </div>
          </div>
        </div>
      )}

      {selected && includesSpans && selected.text == null && (
        <div className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          Selected document is missing raw text in response.
        </div>
      )}
    </section>
  );
}
