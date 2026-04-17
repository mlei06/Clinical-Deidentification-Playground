import {
  useMemo,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { clsx } from 'clsx';
import { labelColor } from '../../lib/labelColors';
import { phiSpanKey, isRangeUncovered } from '../../lib/phiSpanKey';
import { spanRangeKey } from '../../lib/spanOverlapConflicts';
import { scrollTextRangeIntoView } from '../../lib/scrollRangeIntoView';
import type { SpanLabelConflict } from '../../lib/traceConflicts';
import LabelBadge from './LabelBadge';
import type { PHISpanResponse } from '../../api/types';

export interface SpanHighlighterHandle {
  scrollToRange: (start: number, end: number) => void;
  scrollToSpanKey: (key: string) => void;
}

interface SpanHighlighterProps {
  text: string;
  spans: PHISpanResponse[];
  activeSpanKey?: string | null;
  /** Brief pulse / ring on this span key (e.g. navigated from sidebar). */
  flashSpanKey?: string | null;
  onSpanHover?: (key: string | null) => void;
  onSpanClick?: (span: PHISpanResponse, key: string, anchor: DOMRect) => void;
  /** Unflagged selection; `anchor` is where to place a floating label menu. */
  onUncoveredSelection?: (
    sel: { start: number; end: number; text: string },
    anchor: DOMRect,
  ) => void;
  /** Collapsed selection, empty text, covered range, or selection outside source — clear pending UI. */
  onClearPendingSelection?: () => void;
  /** Optional pending selection range to tint in the source (Missed PHI). */
  pendingGhostRange?: { start: number; end: number } | null;
  /** Brief pulse / ring on a plain-text range (e.g. navigated from sidebar). */
  pulseRange?: { start: number; end: number } | null;
  /** Same text range flagged differently in trace (regex vs whitelist). */
  conflictBySpanKey?: Map<string, SpanLabelConflict>;
  onConflictClick?: (c: SpanLabelConflict, anchor: DOMRect) => void;
  /** Same indices, different labels — client-side overlap conflicts. */
  overlapConflictRangeKeys?: Set<string>;
  overlapSpanCandidatesByRange?: Map<string, PHISpanResponse[]>;
  onOverlapConflictClick?: (rangeKey: string, spans: PHISpanResponse[], anchor: DOMRect) => void;
}

interface SegmentMeta {
  text: string;
  span: PHISpanResponse | null;
  textStart: number;
  textEnd: number;
}

function buildSegments(text: string, spans: PHISpanResponse[]): SegmentMeta[] {
  if (spans.length === 0) {
    return [{ text, span: null, textStart: 0, textEnd: text.length }];
  }

  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const segments: SegmentMeta[] = [];
  let cursor = 0;

  for (const span of sorted) {
    if (span.start < cursor) continue;
    if (span.start > cursor) {
      segments.push({
        text: text.slice(cursor, span.start),
        span: null,
        textStart: cursor,
        textEnd: span.start,
      });
    }
    segments.push({
      text: text.slice(span.start, span.end),
      span,
      textStart: span.start,
      textEnd: span.end,
    });
    cursor = span.end;
  }

  if (cursor < text.length) {
    segments.push({
      text: text.slice(cursor),
      span: null,
      textStart: cursor,
      textEnd: text.length,
    });
  }

  return segments;
}

function offsetUpTo(root: HTMLElement, container: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(root, 0);
  try {
    r.setEnd(container, offset);
  } catch {
    return 0;
  }
  const frag = r.cloneContents();
  frag.querySelectorAll('[data-no-offset="true"]').forEach((el) => el.remove());
  const holder = document.createElement('div');
  holder.appendChild(frag);
  return holder.textContent?.length ?? 0;
}

function rangeToTextOffsets(root: HTMLElement, range: Range): { start: number; end: number } | null {
  if (!root.contains(range.commonAncestorContainer)) return null;
  const start = offsetUpTo(root, range.startContainer, range.startOffset);
  const end = offsetUpTo(root, range.endContainer, range.endOffset);
  if (start > end) return null;
  return { start, end };
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.max(a0, b0) < Math.min(a1, b1);
}

function PlainWithGhost({
  text,
  g0,
  g1,
  ghost,
  pulse,
}: {
  text: string;
  g0: number;
  g1: number;
  ghost: { start: number; end: number } | null | undefined;
  pulse?: { start: number; end: number } | null;
}) {
  if (!ghost && !pulse) return <>{text}</>;

  const cuts = new Set<number>([g0, g1]);
  if (ghost) {
    cuts.add(Math.max(g0, ghost.start));
    cuts.add(Math.min(g1, ghost.end));
  }
  if (pulse) {
    cuts.add(Math.max(g0, pulse.start));
    cuts.add(Math.min(g1, pulse.end));
  }
  const xs = [...cuts].filter((x) => x >= g0 && x <= g1).sort((a, b) => a - b);

  const out: ReactNode[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i];
    const b = xs[i + 1];
    if (a >= b) continue;
    const slice = text.slice(a - g0, b - g0);
    const g = Boolean(ghost && overlaps(a, b, ghost.start, ghost.end));
    const p = Boolean(pulse && overlaps(a, b, pulse.start, pulse.end));
    out.push(
      <span
        key={`${a}-${b}`}
        className={clsx(
          g && 'rounded-sm bg-amber-100/90 ring-1 ring-amber-300/70',
          p && 'ring-2 ring-blue-500 ring-offset-1 animate-pulse',
        )}
      >
        {slice}
      </span>,
    );
  }
  return <>{out}</>;
}

const SpanHighlighter = forwardRef<SpanHighlighterHandle, SpanHighlighterProps>(
  function SpanHighlighter(
    {
      text,
      spans,
      activeSpanKey,
      flashSpanKey,
      onSpanHover,
      onSpanClick,
      onUncoveredSelection,
      onClearPendingSelection,
      pendingGhostRange,
      pulseRange,
      conflictBySpanKey,
      onConflictClick,
      overlapConflictRangeKeys,
      overlapSpanCandidatesByRange,
      onOverlapConflictClick,
    },
    ref,
  ) {
    const rootRef = useRef<HTMLPreElement>(null);
    const segments = useMemo(() => buildSegments(text, spans), [text, spans]);

    const spanByKey = useMemo(() => {
      const m = new Map<string, PHISpanResponse>();
      for (const s of spans) m.set(phiSpanKey(s), s);
      return m;
    }, [spans]);

    useImperativeHandle(
      ref,
      () => ({
        scrollToRange: (start: number, end: number) => {
          if (!rootRef.current) return;
          scrollTextRangeIntoView(rootRef.current, text, start, end);
        },
        scrollToSpanKey: (key: string) => {
          const s = spanByKey.get(key);
          if (!s || !rootRef.current) return;
          scrollTextRangeIntoView(rootRef.current, text, s.start, s.end);
        },
      }),
      [text, spanByKey],
    );

    const handleMouseUp = useCallback(() => {
      if (!rootRef.current) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        onClearPendingSelection?.();
        return;
      }
      const range = sel.getRangeAt(0);
      const offsets = rangeToTextOffsets(rootRef.current, range);
      if (!offsets) {
        onClearPendingSelection?.();
        return;
      }
      const { start, end } = offsets;
      const slice = text.slice(start, end);
      if (!slice.trim()) {
        onClearPendingSelection?.();
        return;
      }
      if (!isRangeUncovered(start, end, spans)) {
        onClearPendingSelection?.();
        return;
      }
      if (!onUncoveredSelection) return;
      const rect = range.getBoundingClientRect();
      onUncoveredSelection({ start, end, text: slice }, rect);
    }, [onClearPendingSelection, onUncoveredSelection, spans, text]);

    return (
      <pre
        ref={rootRef}
        onMouseUp={handleMouseUp}
        className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed"
      >
        {segments.map((seg, i) => {
          if (!seg.span) {
            return (
              <span key={i}>
                <PlainWithGhost
                  text={seg.text}
                  g0={seg.textStart}
                  g1={seg.textEnd}
                  ghost={pendingGhostRange}
                  pulse={pulseRange}
                />
              </span>
            );
          }
          const s = seg.span;
          const c = labelColor(s.label);
          const key = phiSpanKey(s);
          const rangeK = spanRangeKey(s.start, s.end);
          const isActive = activeSpanKey != null && activeSpanKey === key;
          const isFlash = flashSpanKey != null && flashSpanKey === key;
          const traceConflict = conflictBySpanKey?.get(key);
          const overlapConflict =
            overlapConflictRangeKeys?.has(rangeK) &&
            (overlapSpanCandidatesByRange?.get(rangeK)?.length ?? 0) > 1;
          const traceOnlyConflict = Boolean(traceConflict) && !overlapConflict;

          const baseTitle = `${s.label}${s.confidence != null ? ` (${(s.confidence * 100).toFixed(0)}%)` : ''}${s.source ? ` — ${s.source}` : ''}`;
          const title = overlapConflict
            ? `Label conflict: multiple labels for [${s.start}–${s.end}]. Click to resolve.`
            : traceConflict
              ? `Conflict: ${traceConflict.pipeA} → ${traceConflict.labelA} vs ${traceConflict.pipeB} → ${traceConflict.labelB}`
              : baseTitle;

          return (
            <mark
              key={i}
              data-span-key={key}
              data-range-key={rangeK}
              className={clsx(
                'relative inline cursor-pointer rounded-sm px-0.5 transition-shadow',
                isActive && 'ring-2 ring-blue-500 ring-offset-1',
                isFlash && 'animate-pulse ring-2 ring-amber-400 ring-offset-1',
                overlapConflict && 'ring-1 ring-rose-300/60',
                traceOnlyConflict && 'border-2 border-dashed border-amber-500 bg-amber-50',
              )}
              style={
                overlapConflict
                  ? { backgroundColor: c.bg, borderBottom: `2px dashed rgb(225 29 72)` }
                  : traceOnlyConflict
                    ? undefined
                    : { backgroundColor: c.bg, borderBottom: `2px solid ${c.border}` }
              }
              title={title}
              onMouseEnter={() => onSpanHover?.(key)}
              onMouseLeave={() => onSpanHover?.(null)}
              onClick={(e: MouseEvent<HTMLElement>) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const candidates = overlapSpanCandidatesByRange?.get(rangeK);
                if (overlapConflict && candidates && candidates.length > 1 && onOverlapConflictClick) {
                  onOverlapConflictClick(rangeK, candidates, rect);
                  return;
                }
                if (traceConflict && onConflictClick) {
                  onConflictClick(traceConflict, rect);
                  return;
                }
                onSpanClick?.(s, key, rect);
              }}
            >
              <LabelBadge label={s.label} className="absolute -top-4 left-0" data-no-offset="true" />
              {seg.text}
            </mark>
          );
        })}
      </pre>
    );
  },
);

export default SpanHighlighter;
