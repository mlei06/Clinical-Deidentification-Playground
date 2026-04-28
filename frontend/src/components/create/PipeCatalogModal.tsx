import { useMemo, useState } from 'react';
import { X, Search, AlertCircle, Info, Shuffle, Scissors, Search as SearchIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { buildPipeCatalogGroups } from '../../lib/pipeCatalogGroups';
import { lintPipeInsertion } from '../../lib/pipeOrderLint';
import type { PipelineSequenceEntry } from '../../lib/pipelineToSequence';
import type { PipeTypeInfo } from '../../api/types';
import { usePipeTypes } from '../../hooks/usePipeTypes';

const ROLE_ICONS: Record<string, typeof SearchIcon> = {
  detector: SearchIcon,
  span_transformer: Shuffle,
  redactor: Scissors,
  preprocessor: Shuffle,
};

const ROLE_FILTERS: { role: string | null; label: string }[] = [
  { role: null, label: 'All' },
  { role: 'detector', label: 'Detectors' },
  { role: 'span_transformer', label: 'Transformers' },
  { role: 'preprocessor', label: 'Preprocessors' },
];

type PipeCatalogModalProps = {
  open: boolean;
  onClose: () => void;
  onPick: (pipe: PipeTypeInfo) => void;
  currentPipes?: PipelineSequenceEntry[];
  insertIndex?: number | null;
};

export default function PipeCatalogModal({
  open,
  onClose,
  onPick,
  currentPipes,
  insertIndex,
}: PipeCatalogModalProps) {
  const { data: pipeTypes } = usePipeTypes();
  const [q, setQ] = useState('');
  const [activeRole, setActiveRole] = useState<string | null>(null);

  const groups = useMemo(() => {
    let base = buildPipeCatalogGroups(pipeTypes);
    if (activeRole) {
      base = base.filter((g) => g.role === activeRole);
    }
    if (!q.trim()) return base;
    const n = q.trim().toLowerCase();
    return base
      .map((g) => ({
        ...g,
        pipes: g.pipes.filter(
          (p) =>
            p.name.toLowerCase().includes(n) || p.description.toLowerCase().includes(n),
        ),
      }))
      .filter((g) => g.pipes.length > 0);
  }, [pipeTypes, q, activeRole]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="flex max-h-[min(80vh,560px)] w-full max-w-md flex-col rounded-lg border border-gray-200 bg-white shadow-xl"
        role="dialog"
        aria-label="Add pipe"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <span className="text-sm font-semibold text-gray-900">Add pipe</span>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100">
            <X size={16} />
          </button>
        </div>
        <div className="border-b border-gray-100 px-4 py-2">
          <div className="mb-2 flex flex-wrap gap-1">
            {ROLE_FILTERS.map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={() => setActiveRole(f.role)}
                className={clsx(
                  'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                  activeRole === f.role
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5">
            <Search size={14} className="shrink-0 text-gray-400" />
            <input
              className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none"
              placeholder="Search pipes…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {groups.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-gray-500">No pipes match this search.</p>
          )}
          {groups.map((g) => (
            <div key={g.role} className="mb-3">
              <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                {g.label}
              </div>
              <div className="flex flex-col gap-0.5">
                {g.pipes.map((p) => {
                  const Icon = ROLE_ICONS[p.role] ?? SearchIcon;
                  const orderHint =
                    currentPipes && typeof insertIndex === 'number'
                      ? lintPipeInsertion(currentPipes, insertIndex, p)
                      : null;
                  return (
                    <button
                      key={p.name}
                      type="button"
                      disabled={!p.installed}
                      onClick={() => {
                        onPick(p);
                        onClose();
                        setQ('');
                      }}
                      className={clsx(
                        'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left',
                        p.installed
                          ? 'hover:bg-gray-50'
                          : 'cursor-not-allowed opacity-50',
                      )}
                    >
                      <Icon size={14} className="mt-0.5 shrink-0 text-gray-400" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-gray-800">
                          {p.name.replace(/_/g, ' ')}
                        </div>
                        <div className="line-clamp-1 text-[10px] text-gray-500">{p.description}</div>
                        {orderHint && (
                          <div className="mt-0.5 flex items-start gap-1 text-[10px] italic text-amber-700">
                            <Info size={10} className="mt-0.5 shrink-0" />
                            <span>{orderHint}</span>
                          </div>
                        )}
                        {!p.installed && p.install_hint && (
                          <div className="mt-0.5 text-[10px] text-amber-700">
                            {p.install_hint}
                          </div>
                        )}
                      </div>
                      {!p.installed && (
                        <span className="inline-flex shrink-0" title={p.install_hint}>
                          <AlertCircle size={12} className="text-amber-500" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
