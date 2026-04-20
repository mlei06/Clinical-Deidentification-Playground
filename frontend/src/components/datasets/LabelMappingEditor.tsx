import { Trash2, Plus } from 'lucide-react';
import { useMemo } from 'react';
import type { DatasetLabelFrequency } from '../../api/types';
import { COMMON_NER_TAGS } from './transformConstants';

export interface MappingRow {
  id: string;
  fromLabel: string;
  toLabel: string;
}

interface LabelMappingEditorProps {
  schemaLabels: DatasetLabelFrequency[];
  rows: MappingRow[];
  onChange: (rows: MappingRow[]) => void;
  highlightError?: boolean;
  disabled?: boolean;
}

function newRow(): MappingRow {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    fromLabel: '',
    toLabel: '',
  };
}

/** Source dropdown + target combobox rows with add/delete. */
export default function LabelMappingEditor({
  schemaLabels,
  rows,
  onChange,
  highlightError,
  disabled,
}: LabelMappingEditorProps) {
  const sourceOptions = useMemo(() => {
    const seen = new Set(schemaLabels.map((x) => x.label));
    return [...schemaLabels.map((x) => x.label)].sort((a, b) => a.localeCompare(b));
  }, [schemaLabels]);

  const usedFrom = useMemo(() => new Set(rows.map((r) => r.fromLabel).filter(Boolean)), [rows]);

  const targetsDatalistId = 'transform-target-ner-tags';

  const update = (id: string, patch: Partial<MappingRow>) => {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRow = (id: string) => {
    onChange(rows.filter((r) => r.id !== id));
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        className={`overflow-hidden rounded-md border ${
          highlightError ? 'border-red-400 ring-1 ring-red-200' : 'border-gray-200'
        } bg-white`}
      >
        <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500">
          <span>Source label</span>
          <span className="text-center text-gray-400">→</span>
          <span>Target label</span>
          <span />
        </div>
        <div className="flex flex-col divide-y divide-gray-100">
          {rows.map((row) => (
            <div key={row.id} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2 px-3 py-2">
              <select
                disabled={disabled}
                value={row.fromLabel}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v && usedFrom.has(v) && v !== row.fromLabel) return;
                  update(row.id, { fromLabel: v });
                }}
                className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs font-mono shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
              >
                <option value="">Select label…</option>
                {sourceOptions.map((lab) => (
                  <option
                    key={lab}
                    value={lab}
                    disabled={Boolean(lab && usedFrom.has(lab) && lab !== row.fromLabel)}
                  >
                    {lab}
                  </option>
                ))}
              </select>
              <span className="text-center text-gray-400">→</span>
              <div className="relative">
                <input
                  disabled={disabled}
                  type="text"
                  value={row.toLabel}
                  onChange={(e) => update(row.id, { toLabel: e.target.value })}
                  placeholder="Target (e.g. PERSON)…"
                  list={targetsDatalistId}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
                />
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => removeRow(row.id)}
                className="flex justify-center rounded p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                title="Remove row"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>
      <datalist id={targetsDatalistId}>
        {COMMON_NER_TAGS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...rows, newRow()])}
        className="inline-flex items-center gap-1 self-start rounded border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-50"
      >
        <Plus size={14} /> Add mapping
      </button>
    </div>
  );
}

export function mappingRowsToRecord(rows: MappingRow[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const f = r.fromLabel.trim();
    const t = r.toLabel.trim();
    if (f && t) out[f] = t;
  }
  return Object.keys(out).length ? out : undefined;
}
