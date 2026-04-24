import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import SpanHighlighter from '../shared/SpanHighlighter';
import type {
  EntitySpanResponse,
  EvalPerDocumentItem,
  EvalSpanLite,
} from '../../api/types';

type SortKey = 'strict_f1' | 'precision' | 'recall' | 'fp' | 'fn' | 'id' | 'rwr';

interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

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

function getSortValue(item: EvalPerDocumentItem, key: SortKey): number | string {
  switch (key) {
    case 'strict_f1':
      return item.metrics.strict?.f1 ?? 0;
    case 'precision':
      return item.metrics.strict?.precision ?? 0;
    case 'recall':
      return item.metrics.strict?.recall ?? 0;
    case 'fp':
      return item.false_positive_count;
    case 'fn':
      return item.false_negative_count;
    case 'rwr':
      return item.risk_weighted_recall;
    case 'id':
      return item.document_id;
  }
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
  const [sort, setSort] = useState<SortState>({ key: 'strict_f1', dir: 'asc' });
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.document_id ?? null);

  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      const av = getSortValue(a, sort.key);
      const bv = getSortValue(b, sort.key);
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [items, sort]);

  const selected = useMemo(
    () => sorted.find((it) => it.document_id === selectedId) ?? sorted[0] ?? null,
    [sorted, selectedId],
  );

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'id' ? 'asc' : 'desc' },
    );
  };

  const sortCaret = (key: SortKey) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-800">Per-document inspection</h3>
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <span>
            Showing {items.length} of {total} {truncated ? '(truncated, worst-F1 first)' : ''}
          </span>
          {!includesSpans && (
            <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-800">
              No spans in response — re-run with “Include gold vs pred spans” to compare highlights.
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              {(
                [
                  ['id', 'Document'],
                  ['strict_f1', 'Strict F1'],
                  ['precision', 'P'],
                  ['recall', 'R'],
                  ['fp', 'FP'],
                  ['fn', 'FN'],
                  ['rwr', 'RWR'],
                ] as [SortKey, string][]
              ).map(([key, label]) => (
                <th
                  key={key}
                  onClick={() => toggleSort(key)}
                  className="cursor-pointer border-b border-gray-200 px-2 py-1.5 text-left font-medium hover:bg-gray-100"
                >
                  {label}
                  {sortCaret(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((it) => {
              const isSel = selected?.document_id === it.document_id;
              return (
                <tr
                  key={it.document_id}
                  onClick={() => setSelectedId(it.document_id)}
                  className={clsx(
                    'cursor-pointer border-b border-gray-100 hover:bg-gray-50',
                    isSel && 'bg-indigo-50/60',
                  )}
                >
                  <td className="px-2 py-1 font-mono text-[11px] text-gray-700">{it.document_id}</td>
                  <td className="px-2 py-1 text-gray-800">{formatScore(it.metrics.strict?.f1 ?? 0)}</td>
                  <td className="px-2 py-1 text-gray-600">{formatScore(it.metrics.strict?.precision ?? 0)}</td>
                  <td className="px-2 py-1 text-gray-600">{formatScore(it.metrics.strict?.recall ?? 0)}</td>
                  <td className="px-2 py-1 text-rose-700">{it.false_positive_count}</td>
                  <td className="px-2 py-1 text-amber-700">{it.false_negative_count}</td>
                  <td className="px-2 py-1 text-gray-600">{formatScore(it.risk_weighted_recall)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
    </section>
  );
}
