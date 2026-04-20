import { useMemo, useState } from 'react';
import type { DatasetLabelFrequency } from '../../api/types';

interface SearchableLabelSelectProps {
  options: DatasetLabelFrequency[];
  value: string;
  onChange: (label: string) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
}

/** Single-select combobox: type to filter, pick a dataset label with optional frequency hint. */
export default function SearchableLabelSelect({
  options,
  value,
  onChange,
  disabled,
  placeholder = 'Search labels…',
  id = 'searchable-label-select',
}: SearchableLabelSelectProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return options.filter(
      (o) => !ql || o.label.toLowerCase().includes(ql),
    );
  }, [options, q]);

  return (
    <div className="relative w-full">
      <input
        id={id}
        type="text"
        disabled={disabled}
        value={open ? q : value}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setQ('');
          setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder={value && !open ? value : placeholder}
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {open && !disabled && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-44 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg"
        >
          {filtered.slice(0, 80).map((o) => (
            <li key={o.label}>
              <button
                type="button"
                role="option"
                className="flex w-full justify-between gap-2 px-3 py-1.5 text-left hover:bg-gray-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(o.label);
                  setQ('');
                  setOpen(false);
                }}
              >
                <span className="font-mono text-xs">{o.label}</span>
                <span className="text-xs text-gray-400">{o.count.toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
