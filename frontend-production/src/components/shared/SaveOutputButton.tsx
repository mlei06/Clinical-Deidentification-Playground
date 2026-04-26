import { Loader2, Save } from 'lucide-react';
import { clsx } from 'clsx';
import type { SavedOutputMode } from '../production/store';

interface SaveOutputButtonProps {
  onSave: (mode: SavedOutputMode) => void | Promise<void>;
  isSaving?: boolean;
  savingMode?: SavedOutputMode | null;
  isStale?: boolean;
  savedMode?: SavedOutputMode | null;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  block?: boolean;
}

const MODES: { mode: SavedOutputMode; label: string; hint: string }[] = [
  {
    mode: 'annotated',
    label: 'Annotated',
    hint: 'Snapshot current spans on original text. No API call.',
  },
  {
    mode: 'redacted',
    label: 'Redacted',
    hint: 'Redact spans with [LABEL] tags via /process/redact.',
  },
  {
    mode: 'surrogate_annotated',
    label: 'Surrogate',
    hint: 'Generate surrogate text with aligned spans via /process/redact.',
  },
];

export default function SaveOutputButton({
  onSave,
  isSaving = false,
  savingMode = null,
  isStale = false,
  savedMode,
  disabled = false,
  size = 'sm',
  className,
  block = false,
}: SaveOutputButtonProps) {
  const padding = size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs';

  return (
    <div
      className={clsx(
        'inline-flex rounded',
        block && 'w-full',
        isStale && 'ring-2 ring-amber-300 ring-offset-0',
        className,
      )}
    >
      {MODES.map(({ mode, label, hint }, i) => {
        const isFirst = i === 0;
        const isLast = i === MODES.length - 1;
        const isSavedHere = savedMode === mode;
        const isSavingThis = savingMode === mode;

        return (
          <button
            key={mode}
            type="button"
            onClick={() => void onSave(mode)}
            disabled={disabled || isSaving}
            title={hint}
            className={clsx(
              'inline-flex flex-1 items-center justify-center gap-1 border border-gray-900 font-medium text-white transition-colors disabled:opacity-40',
              padding,
              isFirst && 'rounded-l',
              isLast && 'rounded-r',
              !isFirst && 'border-l-0',
              isSavedHere
                ? 'bg-gray-600 hover:bg-gray-500'
                : 'bg-gray-900 hover:bg-gray-800',
            )}
          >
            {isSavingThis ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Save size={12} />
            )}
            {label}
          </button>
        );
      })}
    </div>
  );
}
