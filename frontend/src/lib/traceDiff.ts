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

type SpanLite = { start: number; end: number; label: string };

export interface SpanSetDiff {
  added: SpanLite[];
  removed: SpanLite[];
  kept: SpanLite[];
}

function spanKey(s: SpanLite): string {
  return `${s.start}:${s.end}:${s.label}`;
}

export function diffSpans(prior: SpanLite[], current: SpanLite[]): SpanSetDiff {
  const priorKeys = new Set(prior.map(spanKey));
  const currentKeys = new Set(current.map(spanKey));
  return {
    added: current.filter((s) => !priorKeys.has(spanKey(s))),
    removed: prior.filter((s) => !currentKeys.has(spanKey(s))),
    kept: current.filter((s) => priorKeys.has(spanKey(s))),
  };
}

export type DiffCharState = 'plain' | 'added' | 'removed';

export interface DiffCharSegment {
  state: DiffCharState;
  text: string;
}

/**
 * Classify each char of ``text`` by whether it falls inside an added or
 * removed span, then group into contiguous segments. Assumes the text itself
 * is unchanged between frames; the caller should switch to ``diffTextWords``
 * when the text differs.
 */
export function segmentSpanDiff(
  text: string,
  added: SpanLite[],
  removed: SpanLite[],
): DiffCharSegment[] {
  const states: DiffCharState[] = new Array(text.length).fill('plain');
  for (const s of removed) {
    for (let i = s.start; i < s.end && i < text.length; i++) states[i] = 'removed';
  }
  /** ``added`` wins over ``removed`` where both overlap — the new state is what the user sees next. */
  for (const s of added) {
    for (let i = s.start; i < s.end && i < text.length; i++) states[i] = 'added';
  }
  const segments: DiffCharSegment[] = [];
  let i = 0;
  while (i < text.length) {
    const state = states[i];
    let j = i + 1;
    while (j < text.length && states[j] === state) j++;
    segments.push({ state, text: text.slice(i, j) });
    i = j;
  }
  return segments;
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
