import { useState } from 'react';
import { clsx } from 'clsx';
import { Search, Shuffle, ChevronDown, ChevronUp, Trash2, GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PipelineSequenceEntry } from '../../lib/pipelineToSequence';
import { pipeConfigExpandedText, pipeConfigOneLiner } from '../../lib/pipeConfigSummary';
import { usePipelineEditorStore } from '../../stores/pipelineEditorStore';
import { usePipeReadiness } from '../../hooks/usePipeReadiness';
import PipeStatusBadge from './PipeStatusBadge';

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
};

export default function PipeCard({ entry, index, isActive, onSelect, onDelete }: PipeCardProps) {
  const { id, data } = entry;
  const [expanded, setExpanded] = useState(false);
  const style = ROLE_STYLES[data.role] ?? ROLE_STYLES.detector;
  const Icon = style.icon;
  const oneLiner = pipeConfigOneLiner(data);
  const expandedText = pipeConfigExpandedText(data);
  const validation = usePipelineEditorStore((s) => s.validationByPipeId[id]);
  const lastRun = usePipelineEditorStore((s) => s.lastRun);
  const { data: readiness } = usePipeReadiness(
    data.installed ? data.pipeType : null,
    data.config as Record<string, unknown>,
  );

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  const traceStats = (() => {
    if (!lastRun || index >= lastRun.frames.length) return null;
    const cur = lastRun.frames[index];
    if (!cur?.document) return null;
    const curCount = cur.document.spans.length;
    const prevCount =
      index === 0 ? 0 : lastRun.frames[index - 1]?.document?.spans.length ?? 0;
    return {
      total: curCount,
      added: Math.max(0, curCount - prevCount),
      dropped: Math.max(0, prevCount - curCount),
      elapsedMs: cur.elapsed_ms,
    };
  })();

  return (
    <article
      ref={setNodeRef}
      style={sortableStyle}
      className={clsx(
        'w-full overflow-hidden rounded-lg border bg-white shadow-sm transition-shadow',
        'border-l-4',
        style.border,
        isActive
          ? 'ring-2 ring-blue-500 ring-offset-1 border-gray-200'
          : 'border-gray-200 hover:border-gray-300',
        !data.installed && 'opacity-80',
        isDragging && 'z-10 shadow-lg ring-2 ring-blue-300',
      )}
    >
      <div className="w-full" onClick={() => onSelect(id)} role="presentation">
        <div className="flex items-stretch gap-1 px-2 py-2 sm:px-3">
          <div
            className="flex shrink-0 items-center"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="cursor-grab touch-none rounded p-1.5 text-gray-400 hover:bg-gray-100 active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-blue-400"
              title="Drag to reorder (or focus and press Space, then ↑/↓, Space to drop)"
              {...attributes}
              {...listeners}
            >
              <GripVertical size={16} />
            </button>
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
                {!expanded && traceStats && (
                  <p className="mt-0.5 truncate text-[11px] tabular-nums text-slate-500">
                    {traceStats.added > 0 && (
                      <span className="text-emerald-600">+{traceStats.added}</span>
                    )}
                    {traceStats.added > 0 && traceStats.dropped > 0 && (
                      <span className="text-slate-300"> · </span>
                    )}
                    {traceStats.dropped > 0 && (
                      <span className="text-red-600">−{traceStats.dropped}</span>
                    )}
                    {(traceStats.added > 0 || traceStats.dropped > 0) && (
                      <span className="text-slate-300"> · </span>
                    )}
                    <span>{traceStats.total} spans</span>
                    {typeof traceStats.elapsedMs === 'number' && (
                      <>
                        <span className="text-slate-300"> · </span>
                        <span>{traceStats.elapsedMs.toFixed(1)} ms</span>
                      </>
                    )}
                  </p>
                )}
              </div>
              <div
                className="flex shrink-0 items-center gap-0.5"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <PipeStatusBadge
                  validation={validation}
                  readiness={readiness}
                  installed={data.installed}
                />
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
