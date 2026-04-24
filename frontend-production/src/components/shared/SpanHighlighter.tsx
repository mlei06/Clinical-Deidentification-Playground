import {
  useMemo,
  useRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { clsx } from 'clsx';
import { labelColor } from '../../lib/labelColors';
import { entitySpanKey, isRangeUncovered } from '../../lib/entitySpanKey';
import { spanRangeKey } from '../../lib/spanOverlapConflicts';
import { scrollTextRangeIntoView } from '../../lib/scrollRangeIntoView';
import type { SpanLabelConflict } from '../../lib/traceConflicts';
import LabelBadge from './LabelBadge';
import type { EntitySpanResponse } from '../../api/types';

export interface SpanHighlighterHandle {
  scrollToRange: (start: number, end: number) => void;
  scrollToSpanKey: (key: string) => void;
}

interface SpanHighlighterProps {
  text: string;
  spans: EntitySpanResponse[];
  activeSpanKey?: string | null;
  flashSpanKey?: string | null;
  onSpanHover?: (key: string | null) => void;
  onSpanClick?: (span: EntitySpanResponse, key: string, anchor: DOMRect) => void;
  onUncoveredSelection?: (
    sel: { start: number; end: number; text: string },
    anchor: DOMRect,
  ) => void;
  onClearPendingSelection?: () => void;
  pendingGhostRange?: { start: number; end: number } | null;
  pulseRange?: { start: number; end: number } | null;
  conflictBySpanKey?: Map<string, SpanLabelConflict>;
  onConflictClick?: (c: SpanLabelConflict, anchor: DOMRect) => void;
  overlapConflictRangeKeys?: Set<string>;
  overlapSpanCandidatesByRange?: Map<string, EntitySpanResponse[]>;
  onOverlapConflictClick?: (rangeKey: string, spans: EntitySpanResponse[], anchor: DOMRect) => void;
  onSpanResize?: (key: string, start: number, end: number) => void;
}

interface SegmentMeta {
  text: string;
  span: EntitySpanResponse | null;
  textStart: number;
  textEnd: number;
}

function buildSegments(text: string, spans: EntitySpanResponse[]): SegmentMeta[] {
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

interface CaretPosResult {
  offsetNode: Node;
  offset: number;
}

function caretFromPoint(doc: Document, x: number, y: number): CaretPosResult | null {
  const anyDoc = doc as unknown as {
    caretPositionFromPoint?: (x: number, y: number) => CaretPosResult | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof anyDoc.caretPositionFromPoint === 'function') {
    return anyDoc.caretPositionFromPoint(x, y);
  }
  if (typeof anyDoc.caretRangeFromPoint === 'function') {
    const r = anyDoc.caretRangeFromPoint(x, y);
    if (!r) return null;
    return { offsetNode: r.startContainer, offset: r.startOffset };
  }
  return null;
}

function textOffsetFromPoint(root: HTMLElement, x: number, y: number): number | null {
  const pos = caretFromPoint(root.ownerDocument, x, y);
  if (!pos || !root.contains(pos.offsetNode)) return null;
  return offsetUpTo(root, pos.offsetNode, pos.offset);
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
      onSpanResize,
    },
    ref,
  ) {
    const rootRef = useRef<HTMLPreElement>(null);
    const segments = useMemo(() => buildSegments(text, spans), [text, spans]);

    const spanByKey = useMemo(() => {
      const m = new Map<string, EntitySpanResponse>();
      for (const s of spans) m.set(entitySpanKey(s), s);
      return m;
    }, [spans]);

    const siblingBounds = useMemo(() => {
      const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
      const m = new Map<string, { minStart: number; maxEnd: number }>();
      for (let i = 0; i < sorted.length; i++) {
        const prev = i > 0 ? sorted[i - 1] : null;
        const next = i < sorted.length - 1 ? sorted[i + 1] : null;
        m.set(entitySpanKey(sorted[i]), {
          minStart: prev ? prev.end : 0,
          maxEnd: next ? next.start : text.length,
        });
      }
      return m;
    }, [spans, text.length]);

    const dragRef = useRef<{
      key: string;
      side: 'left' | 'right';
      anchorStart: number;
      anchorEnd: number;
      label: string;
      minStart: number;
      maxEnd: number;
    } | null>(null);

    const beginResize = useCallback(
      (side: 'left' | 'right', span: EntitySpanResponse) =>
        (e: MouseEvent<HTMLSpanElement>) => {
          if (!onSpanResize) return;
          e.stopPropagation();
          e.preventDefault();
          const key = entitySpanKey(span);
          const b = siblingBounds.get(key);
          if (!b) return;
          dragRef.current = {
            key,
            side,
            anchorStart: span.start,
            anchorEnd: span.end,
            label: span.label,
            minStart: b.minStart,
            maxEnd: b.maxEnd,
          };
        },
      [onSpanResize, siblingBounds],
    );

    useEffect(() => {
      if (!onSpanResize) return;
      const onMove = (ev: globalThis.MouseEvent) => {
        const drag = dragRef.current;
        if (!drag || !rootRef.current) return;
        const off = textOffsetFromPoint(rootRef.current, ev.clientX, ev.clientY);
        if (off == null) return;
        let newStart = drag.anchorStart;
        let newEnd = drag.anchorEnd;
        if (drag.side === 'left') {
          newStart = Math.min(drag.anchorEnd - 1, Math.max(drag.minStart, off));
        } else {
          newEnd = Math.max(drag.anchorStart + 1, Math.min(drag.maxEnd, off));
        }
        if (newStart === drag.anchorStart && newEnd === drag.anchorEnd && drag.side === 'left') return;
        onSpanResize(drag.key, newStart, newEnd);
        drag.key = `${newStart}-${newEnd}-${drag.label}`;
        if (drag.side === 'left') drag.anchorStart = newStart;
        else drag.anchorEnd = newEnd;
      };
      const onUp = () => {
        dragRef.current = null;
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
    }, [onSpanResize]);

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
          const key = entitySpanKey(s);
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
                'group relative inline cursor-pointer rounded-sm px-0.5 transition-shadow',
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
              {onSpanResize && (
                <span
                  data-no-offset="true"
                  aria-hidden="true"
                  onMouseDown={beginResize('left', s)}
                  className="absolute -left-0.5 top-0 bottom-0 w-1 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-blue-500/60 rounded-sm"
                />
              )}
              {seg.text}
              {onSpanResize && (
                <span
                  data-no-offset="true"
                  aria-hidden="true"
                  onMouseDown={beginResize('right', s)}
                  className="absolute -right-0.5 top-0 bottom-0 w-1 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-blue-500/60 rounded-sm"
                />
              )}
            </mark>
          );
        })}
      </pre>
    );
  },
);

export default SpanHighlighter;
