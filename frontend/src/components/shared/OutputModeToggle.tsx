import { clsx } from 'clsx';
import type { OutputMode } from '../../api/types';

interface OutputModeToggleProps {
  value: OutputMode;
  onChange: (mode: OutputMode) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

const OPTIONS: { value: OutputMode; label: string }[] = [
  { value: 'redacted', label: 'Redacted' },
  { value: 'surrogate', label: 'Surrogate' },
];

export default function OutputModeToggle({
  value,
  onChange,
  disabled = false,
  size = 'sm',
}: OutputModeToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Output view style"
      className="inline-flex items-center gap-0.5 rounded-md border border-gray-200 bg-white p-0.5 shadow-sm"
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={clsx(
              'rounded font-medium transition-colors',
              size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs',
              active
                ? 'bg-gray-900 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
