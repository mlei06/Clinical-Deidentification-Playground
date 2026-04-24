import { useState } from 'react';
import { clsx } from 'clsx';
import { Search, Shuffle, AlertCircle, ChevronDown, ChevronUp, Trash2, GripVertical } from 'lucide-react';
import type { PipelineSequenceEntry } from '../../lib/pipelineToSequence';
import { pipeConfigExpandedText, pipeConfigOneLiner } from '../../lib/pipeConfigSummary';

const ROLE_STYLES: Record<string, { border: string; bg: string; icon: typeof Search }> = {
  detector: { border: 'border-l-blue-500', bg: 'bg-blue-50', icon: Search },
  span_transformer: { border: 'border-l-amber-500', bg: 'bg-amber-50', icon: Shuffle },
  preprocessor: { border: 'border-l-violet-500', bg: 'bg-violet-50', icon: Shuffle },
};

type PipeCardProps = {
  entry: PipelineSequenceEntry;
  index: number;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
};

export default function PipeCard({ entry, index, isActive, onSelect, onDelete, onMove }: PipeCardProps) {
  const { id, data } = entry;
  const [expanded, setExpanded] = useState(false);
  const style = ROLE_STYLES[data.role] ?? ROLE_STYLES.detector;
  const Icon = style.icon;
  const oneLiner = pipeConfigOneLiner(data);
  const expandedText = pipeConfigExpandedText(data);

  return (
    <article
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData('text/pipe-reorder'), 10);
        if (Number.isNaN(from) || from === index) return;
        onMove(from, index);
      }}
      className={clsx(
        'w-full overflow-hidden rounded-lg border bg-white shadow-sm transition-shadow',
        'border-l-4',
        style.border,
        isActive
          ? 'ring-2 ring-blue-500 ring-offset-1 border-gray-200'
          : 'border-gray-200 hover:border-gray-300',
        !data.installed && 'opacity-80',
      )}
    >
      <div className="w-full" onClick={() => onSelect(id)} role="presentation">
        <div className="flex items-stretch gap-1 px-2 py-2 sm:px-3">
          <div
            className="flex shrink-0 items-center"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div
              className="cursor-grab touch-none rounded p-1.5 text-gray-400 hover:bg-gray-100 active:cursor-grabbing"
              draggable
              onClick={(e) => e.stopPropagation()}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/pipe-reorder', String(index));
                e.dataTransfer.effectAllowed = 'move';
              }}
              title="Drag to reorder"
            >
              <GripVertical size={16} />
            </div>
          </div>
          <div
            className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded', style.bg)}
            aria-hidden
          >
            <Icon size={14} className="text-gray-600" />
          </div>
          <div className="min-w-0 flex-1 cursor-pointer py-0.5">
            <div className="flex items-start justify-between gap-1">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold capitalize text-gray-900">{data.label}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">
                  {data.role.replace(/_/g, ' ')}
                </div>
                {!expanded && <p className="mt-0.5 truncate text-xs text-gray-600">{oneLiner}</p>}
              </div>
              <div
                className="flex shrink-0 items-center gap-0.5"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {!data.installed && (
                  <span title="Not fully installed" className="inline-flex">
                    <AlertCircle size={14} className="text-amber-500" />
                  </span>
                )}
                <button
                  type="button"
                  className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  title={expanded ? 'Collapse' : 'Expand details'}
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                <button
                  type="button"
                  className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  title="Remove pipe"
                  onClick={() => onDelete(id)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>
        {expanded && (
          <div
            className="border-t border-gray-100 bg-slate-50/60 px-3 py-2"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">Config snapshot</p>
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-700">
              {expandedText}
            </pre>
            <p className="mt-1.5 text-[10px] text-slate-500">Edit the full form in the panel on the right.</p>
          </div>
        )}
      </div>
    </article>
  );
}
