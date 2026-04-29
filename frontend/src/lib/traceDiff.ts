/**
 * Pure utilities for diffing adjacent pipeline trace frames.
 *
 * Two flavors:
 *   - span-set diff (added / removed by ``(start, end, label)`` key)
 *   - word-level text diff (LCS) for frames where the text itself changed
 *     (preprocessors, redactors)
 *
 * Rendering stays in the component — these functions return plain data.
 */

export interface SpanLite {
  start: number;
  end: number;
  label: string;
}

export interface SpanSetDiff<S extends SpanLite> {
  added: S[];
  removed: S[];
  kept: S[];
}

function spanKey(s: SpanLite): string {
  return `${s.start}:${s.end}:${s.label}`;
}

export function diffSpans<S extends SpanLite>(
  prior: S[],
  current: S[],
): SpanSetDiff<S> {
  const priorKeys = new Set(prior.map(spanKey));
  const currentKeys = new Set(current.map(spanKey));
  return {
    added: current.filter((s) => !priorKeys.has(spanKey(s))),
    removed: prior.filter((s) => !currentKeys.has(spanKey(s))),
    kept: current.filter((s) => priorKeys.has(spanKey(s))),
  };
}

export type DiffStatus = 'kept' | 'added' | 'removed';

/**
 * One renderable unit at ``[start, end)`` for the trace diff view. Mirrors a
 * single ``<mark>`` in the absolute view: ``primary`` provides the bg color
 * and main label badge; ``status`` controls strikethrough / opacity styling.
 *
 * ``removedSiblings`` carries any prior-frame spans that occupied the *same*
 * range (label-change reclassifications) so the renderer can stack their
 * badges above the primary.
 */
export interface SpanDiffUnit<S extends SpanLite> {
  start: number;
  end: number;
  primary: S;
  status: DiffStatus;
  removedSiblings: S[];
}

/**
 * Build only the *changes* introduced by the current frame. Spans kept from
 * prior stages are intentionally omitted so the diff view shows just what
 * this pipe did:
 *
 *   - Added current spans → ``added`` units (full category-coloured highlight).
 *   - Ranges that exist only in ``removed`` → ``removed`` units (strikethrough
 *     + opacity).
 *   - Reclassifications (added current span sharing a range with removed
 *     prior span) attach the prior labels as ``removedSiblings`` on the
 *     ``added`` unit so both labels stay visible.
 *
 * Kept spans are dropped — the renderer treats their text as plain.
 */
export function buildSpanDiffUnits<S extends SpanLite>(
  currentSpans: S[],
  added: S[],
  removed: S[],
): SpanDiffUnit<S>[] {
  const addedKeys = new Set(added.map(spanKey));
  const removedByRange = new Map<string, S[]>();
  for (const r of removed) {
    const k = `${r.start}-${r.end}`;
    const list = removedByRange.get(k);
    if (list) list.push(r);
    else removedByRange.set(k, [r]);
  }

  const units: SpanDiffUnit<S>[] = [];
  const consumedRanges = new Set<string>();

  for (const s of currentSpans) {
    if (!addedKeys.has(spanKey(s))) continue;
    const rangeKey = `${s.start}-${s.end}`;
    const siblings = removedByRange.get(rangeKey) ?? [];
    if (siblings.length > 0) consumedRanges.add(rangeKey);
    units.push({
      start: s.start,
      end: s.end,
      primary: s,
      status: 'added',
      removedSiblings: siblings,
    });
  }

  for (const [rangeKey, list] of removedByRange) {
    if (consumedRanges.has(rangeKey) || list.length === 0) continue;
    const [primary, ...rest] = list;
    units.push({
      start: primary.start,
      end: primary.end,
      primary,
      status: 'removed',
      removedSiblings: rest,
    });
  }

  return units;
}

export interface DiffPlainSegment {
  kind: 'plain';
  start: number;
  end: number;
  text: string;
}

export interface DiffUnitSegment<S extends SpanLite> {
  kind: 'unit';
  start: number;
  end: number;
  text: string;
  unit: SpanDiffUnit<S>;
}

export type DiffSegment<S extends SpanLite> =
  | DiffPlainSegment
  | DiffUnitSegment<S>;

/**
 * Walk ``text`` left-to-right, slicing at each unit boundary. Plain text
 * regions become ``plain`` segments; each unit becomes one ``unit`` segment
 * the renderer wraps in a colored ``<mark>`` (with optional strikethrough +
 * opacity for removed units).
 *
 * Mirrors the segmentation in ``buildCoverageSegments`` so the diff
 * view's text layout stays identical to the absolute view's. Units whose
 * range overlaps an earlier emitted unit are skipped.
 */
export function buildSpanDiffSegments<S extends SpanLite>(
  text: string,
  units: SpanDiffUnit<S>[],
): DiffSegment<S>[] {
  if (units.length === 0) {
    return [{ kind: 'plain', start: 0, end: text.length, text }];
  }
  const sorted = [...units].sort(
    (a, b) => a.start - b.start || b.end - a.end,
  );
  const segs: DiffSegment<S>[] = [];
  let cursor = 0;
  for (const u of sorted) {
    if (u.start < cursor) continue;
    if (u.start > cursor) {
      segs.push({
        kind: 'plain',
        start: cursor,
        end: u.start,
        text: text.slice(cursor, u.start),
      });
    }
    segs.push({
      kind: 'unit',
      start: u.start,
      end: u.end,
      text: text.slice(u.start, u.end),
      unit: u,
    });
    cursor = u.end;
  }
  if (cursor < text.length) {
    segs.push({
      kind: 'plain',
      start: cursor,
      end: text.length,
      text: text.slice(cursor),
    });
  }
  return segs;
}

export type TextSegKind = 'equal' | 'add' | 'remove';

export interface TextSeg {
  kind: TextSegKind;
  text: string;
}

function tokenize(s: string): string[] {
  return s.match(/\S+\s*|\s+/g) ?? [];
}

/** Push a segment into a reverse-order accumulator, merging adjacent same-kind runs. */
function pushReverseSeg(arr: TextSeg[], kind: TextSegKind, text: string): void {
  const last = arr[arr.length - 1];
  if (last && last.kind === kind) {
    last.text = text + last.text;
  } else {
    arr.push({ kind, text });
  }
}

/**
 * Word-level LCS diff. Produces a segment list in forward order describing
 * how to turn ``a`` into ``b``: equals stay, removes are ``a``-only,
 * adds are ``b``-only.
 */
export function diffTextWords(a: string, b: string): TextSeg[] {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const m = tokensA.length;
  const n = tokensB.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (tokensA[i - 1] === tokensB[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const reversed: TextSeg[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && tokensA[i - 1] === tokensB[j - 1]) {
      pushReverseSeg(reversed, 'equal', tokensA[i - 1]);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      pushReverseSeg(reversed, 'add', tokensB[j - 1]);
      j--;
    } else {
      pushReverseSeg(reversed, 'remove', tokensA[i - 1]);
      i--;
    }
  }
  return reversed.reverse();
}

export interface FrameDiffStats {
  addedSpans: number;
  removedSpans: number;
  textChanged: boolean;
  charDelta: number;
}

export function computeFrameDiffStats(
  priorText: string,
  priorSpans: SpanLite[],
  currentText: string,
  currentSpans: SpanLite[],
): FrameDiffStats {
  const { added, removed } = diffSpans(priorSpans, currentSpans);
  return {
    addedSpans: added.length,
    removedSpans: removed.length,
    textChanged: priorText !== currentText,
    charDelta: currentText.length - priorText.length,
  };
}
