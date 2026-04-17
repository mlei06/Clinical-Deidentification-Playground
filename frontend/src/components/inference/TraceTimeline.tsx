import { useState, useMemo } from 'react';
import { clsx } from 'clsx';
import { ChevronRight, ChevronDown, Clock } from 'lucide-react';
import SpanHighlighter from '../shared/SpanHighlighter';
import {
  diffSpans,
  diffTextWords,
  segmentSpanDiff,
  computeFrameDiffStats,
  type FrameDiffStats,
  type TextSeg,
} from '../../lib/traceDiff';
import type { TraceFrame, PHISpanResponse } from '../../api/types';

interface TraceTimelineProps {
  frames: TraceFrame[];
}

type ViewMode = 'diff' | 'absolute';

function traceSpansToResponse(
  frame: TraceFrame,
): { text: string; spans: PHISpanResponse[] } | null {
  if (!frame.document) return null;
  const text = frame.document.document.text;
  const spans: PHISpanResponse[] = frame.document.spans.map((s) => ({
    ...s,
    text: text.slice(s.start, s.end),
  }));
  return { text, spans };
}

function DiffStatsBadge({ stats }: { stats: FrameDiffStats }) {
  const { addedSpans, removedSpans, textChanged, charDelta } = stats;
  const nothing = !addedSpans && !removedSpans && !textChanged;
  if (nothing) {
    return <span className="text-xs text-gray-300">no change</span>;
  }
  return (
    <span className="flex items-center gap-1.5 text-xs">
      {addedSpans > 0 && (
        <span className="rounded bg-emerald-100 px-1 text-[10px] font-medium text-emerald-800">
          +{addedSpans}
        </span>
      )}
      {removedSpans > 0 && (
        <span className="rounded bg-rose-100 px-1 text-[10px] font-medium text-rose-800">
          −{removedSpans}
        </span>
      )}
      {textChanged && (
        <span className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800">
          {charDelta >= 0 ? `+${charDelta}` : charDelta} chars
        </span>
      )}
    </span>
  );
}

function SpanDiffView({
  text,
  added,
  removed,
}: {
  text: string;
  added: { start: number; end: number; label: string }[];
  removed: { start: number; end: number; label: string }[];
}) {
  const segments = useMemo(
    () => segmentSpanDiff(text, added, removed),
    [text, added, removed],
  );
  return (
    <div className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-700">
      {segments.map((seg, i) => (
        <span
          key={i}
          className={clsx(
            seg.state === 'added' && 'rounded bg-emerald-100 px-0.5 text-emerald-900',
            seg.state === 'removed' &&
              'rounded bg-rose-100 px-0.5 text-rose-800 line-through',
          )}
        >
          {seg.text}
        </span>
      ))}
    </div>
  );
}

function TextDiffView({ segs }: { segs: TextSeg[] }) {
  return (
    <div className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-700">
      {segs.map((seg, i) => (
        <span
          key={i}
          className={clsx(
            seg.kind === 'add' && 'rounded bg-emerald-100 px-0.5 text-emerald-900',
            seg.kind === 'remove' &&
              'rounded bg-rose-100 px-0.5 text-rose-800 line-through',
          )}
        >
          {seg.text}
        </span>
      ))}
    </div>
  );
}

export default function TraceTimeline({ frames }: TraceTimelineProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<ViewMode>('diff');

  const toggle = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const frameStats = useMemo(() => {
    return frames.map((frame, i) => {
      const prior = i > 0 ? frames[i - 1] : null;
      if (!prior?.document || !frame.document) return null;
      const priorDoc = prior.document;
      const curDoc = frame.document;
      return computeFrameDiffStats(
        priorDoc.document.text,
        priorDoc.spans,
        curDoc.document.text,
        curDoc.spans,
      );
    });
  }, [frames]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Pipeline Trace ({frames.length} steps)
        </span>
        <div
          role="radiogroup"
          aria-label="Trace view mode"
          className="inline-flex items-center gap-0.5 rounded border border-gray-200 bg-white p-0.5"
        >
          {(['diff', 'absolute'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={clsx(
                'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                mode === m
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-600 hover:bg-gray-100',
              )}
            >
              {m === 'diff' ? 'Diff' : 'Absolute'}
            </button>
          ))}
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        {frames.map((frame, i) => {
          const isOpen = expanded.has(i);
          const doc = traceSpansToResponse(frame);
          const prior = i > 0 ? frames[i - 1] : null;
          const priorDoc = prior ? traceSpansToResponse(prior) : null;
          const stats = frameStats[i];
          /** First frame has no predecessor; render as absolute regardless of the toggle. */
          const effectiveMode: ViewMode = mode === 'diff' && stats ? 'diff' : 'absolute';

          return (
            <div key={i}>
              <button
                onClick={() => toggle(i)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50"
              >
                {isOpen ? (
                  <ChevronDown size={14} className="text-gray-400" />
                ) : (
                  <ChevronRight size={14} className="text-gray-400" />
                )}
                <span className="flex-1 truncate text-sm font-medium text-gray-700">
                  {frame.pipe_type}
                </span>
                {mode === 'diff' && stats ? (
                  <DiffStatsBadge stats={stats} />
                ) : (
                  doc && (
                    <span className="text-xs text-gray-400">
                      {doc.spans.length} span{doc.spans.length !== 1 ? 's' : ''}
                    </span>
                  )
                )}
                {frame.elapsed_ms != null && (
                  <span className="flex items-center gap-0.5 text-xs text-gray-400">
                    <Clock size={11} />
                    {frame.elapsed_ms.toFixed(1)}ms
                  </span>
                )}
              </button>
              {isOpen && doc && (
                <div className="border-t border-gray-100 bg-gray-50 p-4">
                  {effectiveMode === 'diff' && priorDoc && stats ? (
                    stats.textChanged ? (
                      <TextDiffView segs={diffTextWords(priorDoc.text, doc.text)} />
                    ) : (
                      <SpanDiffView
                        text={doc.text}
                        added={diffSpans(priorDoc.spans, doc.spans).added}
                        removed={diffSpans(priorDoc.spans, doc.spans).removed}
                      />
                    )
                  ) : (
                    <SpanHighlighter text={doc.text} spans={doc.spans} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
