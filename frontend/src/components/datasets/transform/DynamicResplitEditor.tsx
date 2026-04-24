import { useCallback } from 'react';

export interface SplitPartRow {
  name: string;
  weight: number;
}

const PALETTE = [
  'bg-sky-100/90 text-sky-900',
  'bg-amber-100/90 text-amber-900',
  'bg-emerald-100/90 text-emerald-900',
  'bg-violet-100/90 text-violet-900',
  'bg-rose-100/90 text-rose-900',
  'bg-cyan-100/90 text-cyan-900',
];

export function defaultResplitRows(): SplitPartRow[] {
  return [
    { name: 'train', weight: 70 },
    { name: 'valid', weight: 15 },
    { name: 'test', weight: 15 },
  ];
}

/** Normalize to relative weights summing to 1 (API: positive floats). */
export function rowsToResplitPayload(rows: SplitPartRow[]): Record<string, number> | undefined {
  const clean = rows
    .map((r) => ({ name: r.name.trim(), weight: Math.max(0, r.weight) }))
    .filter((r) => r.name.length > 0);
  if (clean.length < 1) return undefined;
  const total = clean.reduce((s, r) => s + r.weight, 0);
  if (total <= 0) return undefined;
  const out: Record<string, number> = {};
  for (const r of clean) {
    out[r.name] = r.weight / total;
  }
  return out;
}

interface DynamicResplitEditorProps {
  rows: SplitPartRow[];
  onRowsChange: (rows: SplitPartRow[]) => void;
  sourceDocCount: number;
  disabled?: boolean;
}

export default function DynamicResplitEditor({ rows, onRowsChange, sourceDocCount, disabled }: DynamicResplitEditorProps) {
  const setRow = useCallback(
    (i: number, patch: Partial<SplitPartRow>) => {
      const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
      onRowsChange(next);
    },
    [rows, onRowsChange],
  );

  const addRow = useCallback(() => {
    onRowsChange([...rows, { name: 'split', weight: 10 }]);
  }, [rows, onRowsChange]);

  const removeRow = useCallback(
    (i: number) => {
      if (rows.length <= 1) return;
      onRowsChange(rows.filter((_, j) => j !== i));
    },
    [rows, onRowsChange],
  );

  const totalW = rows.reduce((s, r) => s + Math.max(0, r.weight), 0) || 1;
  const approxCounts = rows.map((r) => {
    const w = Math.max(0, r.weight);
    return Math.max(0, Math.round((sourceDocCount * w) / totalW));
  });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-gray-600">Split mix (relative weights, normalized on save)</p>
      <div className="flex h-9 w-full overflow-hidden rounded-md border border-gray-200 shadow-inner">
        {rows.map((r, i) => {
          const w = (Math.max(0, r.weight) / totalW) * 100;
          const c = PALETTE[i % PALETTE.length];
          return (
            <div
              key={i}
              className={`flex min-w-0 items-center justify-center text-[10px] font-medium ${c}`}
              style={{ width: `${Math.max(0, w)}%` }}
              title={r.name || `Part ${i + 1}`}
            >
              {w >= 6 ? (r.name || `${i + 1}`) : ''}
            </div>
          );
        })}
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={r.name}
              onChange={(e) => setRow(i, { name: e.target.value })}
              disabled={disabled}
              placeholder="split name"
              className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1.5 text-sm sm:max-w-[10rem]"
            />
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                step={0.5}
                value={r.weight}
                onChange={(e) => setRow(i, { weight: Number(e.target.value) || 0 })}
                disabled={disabled}
                className="w-20 rounded border border-gray-200 px-2 py-1.5 text-right text-sm"
              />
              <span className="text-xs text-gray-500">≈{approxCounts[i] ?? 0} docs</span>
            </div>
            <button
              type="button"
              disabled={disabled || rows.length <= 1}
              onClick={() => removeRow(i)}
              className="text-xs text-red-600 disabled:opacity-30"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addRow}
        disabled={disabled}
        className="self-start text-xs font-medium text-gray-700 hover:text-gray-900 disabled:opacity-40"
      >
        + Add split
      </button>
    </div>
  );
}
