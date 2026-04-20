import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { DatasetLabelFrequency } from '../../api/types';

interface LabelChipSelectProps {
  options: DatasetLabelFrequency[];
  value: string[];
  onChange: (next: string[]) => void;
  /** Labels excluded from the picker (mutually exclusive lists). */
  blocked: Set<string>;
  placeholder?: string;
  idPrefix: string;
  onSelectAll?: () => void;
  onClearAll?: () => void;
  disabled?: boolean;
}

/** Typeahead multi-select for dataset labels (chips). */
export default function LabelChipSelect({
  options,
  value,
  onChange,
  blocked,
  placeholder = 'Search labels…',
  idPrefix,
  onSelectAll,
  onClearAll,
  disabled,
}: LabelChipSelectProps) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const pickable = useMemo(() => {
    const qlow = q.trim().toLowerCase();
    return options.filter(
      (o) =>
        !value.includes(o.label) &&
        !blocked.has(o.label) &&
        (qlow === '' || o.label.toLowerCase().includes(qlow)),
    );
  }, [options, value, blocked, q]);

  const listId = `${idPrefix}-listbox`;

  const add = (label: string) => {
    if (blocked.has(label)) return;
    if (!value.includes(label)) onChange([...value, label]);
    setQ('');
  };

  const remove = (label: string) => {
    onChange(value.filter((x) => x !== label));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-[2.25rem] flex-wrap gap-1.5 rounded-md border border-gray-300 bg-white px-2 py-1.5">
        {value.map((label) => (
          <span
            key={label}
            className="inline-flex items-center gap-1 rounded-full bg-gray-900 px-2 py-0.5 text-xs font-medium text-white"
          >
            {label}
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(label)}
                className="rounded p-0.5 hover:bg-white/20"
                aria-label={`Remove ${label}`}
              >
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        <input
          id={`${idPrefix}-input`}
          type="text"
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder={value.length === 0 ? placeholder : ''}
          className="min-w-[8rem] flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-gray-400"
        />
      </div>
      {open && !disabled && pickable.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="max-h-40 overflow-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-md"
        >
          {pickable.slice(0, 64).map((o) => (
            <li key={o.label}>
              <button
                type="button"
                role="option"
                className="flex w-full justify-between gap-2 px-3 py-1.5 text-left hover:bg-gray-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(o.label)}
              >
                <span className="font-mono text-xs">{o.label}</span>
                <span className="text-xs text-gray-400">{o.count.toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(onSelectAll || onClearAll) && (
        <div className="flex gap-2 text-xs">
          {onSelectAll && (
            <button
              type="button"
              className="text-gray-600 underline decoration-gray-300 hover:text-gray-900"
              onClick={onSelectAll}
              disabled={disabled}
            >
              Select all
            </button>
          )}
          {onClearAll && (
            <button
              type="button"
              className="text-gray-600 underline decoration-gray-300 hover:text-gray-900"
              onClick={onClearAll}
              disabled={disabled}
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
