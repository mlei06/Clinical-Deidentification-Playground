import { X } from 'lucide-react';
import { splitLabelForDisplay, UNSPLIT_BUCKET } from '../splitLabels';

export interface TargetSplitOption {
  key: string;
  count: number;
}

interface TargetSplitsMultiSelectProps {
  options: TargetSplitOption[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  id?: string;
  loading?: boolean;
}

/**
 * Pill-based multi-select for dataset splits (``split_document_counts``).
 * Empty selection = full corpus (no `source_splits` on the API).
 */
export default function TargetSplitsMultiSelect({
  options,
  value,
  onChange,
  disabled,
  id = 'target-splits',
  loading,
}: TargetSplitsMultiSelectProps) {
  if (loading) {
    return (
      <div className="text-xs text-gray-500" aria-live="polite">
        Loading split list…
      </div>
    );
  }

  if (options.length === 0) {
    return (
      <p className="text-xs text-gray-500">
        No split metadata found for this dataset. The transform applies to the full corpus. Re-run
        <span className="whitespace-nowrap"> “Refresh” </span>
        in Library if the corpus changed.
      </p>
    );
  }

  const byKey = new Map(options.map((o) => [o.key, o]));
  const valueOrdered = value.filter((k) => byKey.has(k));
  const remaining = options.filter((o) => !valueOrdered.includes(o.key));
  /** Every available split is selected. */
  const allSelected = options.length > 0 && remaining.length === 0;

  const selectAll = () => {
    onChange(options.map((o) => o.key));
  };
  const clearAll = () => onChange([]);
  const remove = (key: string) => onChange(valueOrdered.filter((k) => k !== key));
  const add = (key: string) => {
    if (!key || valueOrdered.includes(key)) return;
    onChange([...valueOrdered, key]);
  };

  return (
    <div className="flex min-w-0 max-w-2xl flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label htmlFor={`${id}-add`} className="text-xs font-medium text-gray-500">
          Target splits <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            className="text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={selectAll}
            disabled={disabled || allSelected}
          >
            Select all
          </button>
          <span className="text-slate-300" aria-hidden>
            |
          </span>
          <button
            type="button"
            className="text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={clearAll}
            disabled={disabled || valueOrdered.length === 0}
          >
            Clear all
          </button>
        </div>
      </div>

      {valueOrdered.length === 0 && (
        <p className="text-xs text-slate-500" role="status">
          Currently targeting 100% of the dataset.
        </p>
      )}

      <div
        className="flex min-h-9 flex-wrap items-center gap-1.5"
        role="list"
        aria-label="Selected target splits"
      >
        {valueOrdered.map((key) => {
          const o = byKey.get(key);
          if (!o) return null;
          return (
            <span
              key={key}
              role="listitem"
              className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-slate-200 bg-slate-100 pl-2.5 pr-0.5 text-xs font-medium text-slate-800"
            >
              <span className="truncate" title={key}>
                {splitLabelForDisplay(key)}
                <span className="ml-1 font-normal text-slate-500">({o.count.toLocaleString()})</span>
              </span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(key)}
                  className="shrink-0 rounded-full p-1 text-slate-500 hover:bg-slate-200/80 hover:text-slate-900"
                  aria-label={`Remove ${splitLabelForDisplay(key)}`}
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
              )}
            </span>
          );
        })}

        {remaining.length > 0 && !disabled && (
          <div className="min-w-0 max-w-full flex-1 sm:max-w-[14rem]">
            <label htmlFor={`${id}-add`} className="sr-only">
              Add a split
            </label>
            <select
              id={`${id}-add`}
              value=""
              onChange={(e) => {
                const k = e.target.value;
                if (k) add(k);
                e.target.value = '';
              }}
              className="w-full min-w-0 rounded-full border border-dashed border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 focus:border-slate-500 focus:ring-1 focus:ring-slate-400 focus:outline-none"
            >
              <option value="">+ Add split…</option>
              {remaining.map((o) => (
                <option key={o.key} value={o.key}>
                  {splitLabelForDisplay(o.key)} — {o.count.toLocaleString()} doc{o.count === 1 ? '' : 's'}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <p className="text-[11px] leading-snug text-slate-400" title="Matches document metadata.split">
        Limit transforms to these buckets. The {splitLabelForDisplay(UNSPLIT_BUCKET)} bucket appears if present in the
        manifest.
      </p>
    </div>
  );
}
