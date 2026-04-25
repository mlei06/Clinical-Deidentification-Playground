import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check, Loader2, Save } from 'lucide-react';
import { clsx } from 'clsx';
import type { SavedOutputMode } from '../production/store';

interface SaveOutputButtonProps {
  /** The mode that the primary action will save in. */
  mode: SavedOutputMode;
  onModeChange: (mode: SavedOutputMode) => void;
  onSave: () => void | Promise<void>;
  isSaving?: boolean;
  /** True when there is a saved output and it is out of date relative to current annotations. */
  isStale?: boolean;
  /** Optional label override for the primary button. */
  primaryLabel?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  block?: boolean;
}

const MODE_LABELS: Record<SavedOutputMode, string> = {
  annotated: 'annotated',
  redacted: 'redacted',
  surrogate_annotated: 'surrogate',
};

const MODE_HINTS: Record<SavedOutputMode, string> = {
  annotated: 'Snapshot current spans on original text. No API call.',
  redacted: 'Redact spans with [LABEL] tags via /process/redact.',
  surrogate_annotated: 'Generate surrogate text with aligned spans via /process/redact.',
};

export default function SaveOutputButton({
  mode,
  onModeChange,
  onSave,
  isSaving = false,
  isStale = false,
  primaryLabel,
  disabled = false,
  size = 'sm',
  className,
  block = false,
}: SaveOutputButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const label = primaryLabel ?? `Save ${MODE_LABELS[mode]}${isStale ? ' · out of date' : ''}`;
  const padding = size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs';
  const ringClass = isStale ? 'ring-2 ring-amber-300 ring-offset-0' : '';

  return (
    <div
      ref={rootRef}
      className={clsx(block ? 'relative flex w-full' : 'relative inline-flex', className)}
    >
      <button
        type="button"
        onClick={() => void onSave()}
        disabled={disabled || isSaving}
        className={clsx(
          'inline-flex items-center justify-center gap-1 rounded-l border border-gray-900 bg-gray-900 font-medium text-white hover:bg-gray-800 disabled:opacity-40',
          block && 'flex-1',
          padding,
          ringClass,
        )}
        title={MODE_HINTS[mode]}
      >
        {isSaving ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Save size={12} />
        )}
        {label}
      </button>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || isSaving}
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx(
          'inline-flex items-center rounded-r border border-l-0 border-gray-900 bg-gray-900 px-1 text-white hover:bg-gray-800 disabled:opacity-40',
          ringClass,
        )}
        title="Pick a save mode"
      >
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-56 rounded border border-gray-200 bg-white p-1 text-[11px] shadow-lg"
        >
          {(['annotated', 'redacted', 'surrogate_annotated'] as SavedOutputMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="menuitem"
              onClick={() => {
                onModeChange(m);
                setOpen(false);
              }}
              className={clsx(
                'flex w-full items-start gap-2 rounded px-2 py-1 text-left hover:bg-gray-50',
                m === mode && 'bg-gray-50',
              )}
            >
              <span className="mt-0.5 inline-flex w-3 shrink-0 justify-center">
                {m === mode ? <Check size={11} className="text-gray-700" /> : null}
              </span>
              <span className="flex flex-col">
                <span className="font-medium text-gray-800">Save {MODE_LABELS[m]}</span>
                <span className="text-[10px] text-gray-500">{MODE_HINTS[m]}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
