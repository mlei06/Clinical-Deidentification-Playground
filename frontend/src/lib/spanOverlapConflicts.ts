import type { PHISpanResponse } from '../api/types';
import { CANONICAL_LABELS } from './canonicalLabels';

/**
 * Mirrors ``DEFAULT_LABEL_PRIORITY`` in ``clinical_deid/pipes/span_merge.py``
 * for ``resolve_spans`` with strategy ``label_priority``.
 */
export const RESOLVE_SPANS_LABEL_PRIORITY: string[] = [
  'NAME',
  'PATIENT',
  'FIRST_NAME',
  'LAST_NAME',
  'SSN',
  'MRN',
  'ID',
  'DATE',
  'DOB',
  'PHONE',
  'FAX',
  'EMAIL',
  'ADDRESS',
  'STREET',
  'CITY',
  'STATE',
  'ZIP',
  'COUNTRY',
  'HOSPITAL',
  'ORGANIZATION',
  'AGE',
  'URL',
  'IP',
  'DEVICE',
  'PLATE',
  'VIN',
  'ACCOUNT',
];

function overlaps(a: PHISpanResponse, b: PHISpanResponse): boolean {
  return a.start < b.end && b.start < a.end;
}

function hasOverlapWithKept(span: PHISpanResponse, kept: PHISpanResponse[]): boolean {
  return kept.some((k) => overlaps(span, k));
}

/**
 * Same greedy merge as ``merge_label_priority`` / ``apply_resolve_spans(..., strategy="label_priority")``.
 * Higher-priority labels (earlier in *labelPriority*) win; ties break by longer span, then leftmost.
 */
export function mergeLabelPrioritySpans(
  spans: PHISpanResponse[],
  labelPriority: string[] = RESOLVE_SPANS_LABEL_PRIORITY,
): PHISpanResponse[] {
  const priorityMap = new Map(labelPriority.map((l, i) => [l, i]));
  const defaultRank = labelPriority.length;
  const all = [...spans].sort((a, b) => {
    const pa = priorityMap.get(a.label) ?? defaultRank;
    const pb = priorityMap.get(b.label) ?? defaultRank;
    if (pa !== pb) return pa - pb;
    const la = a.end - a.start;
    const lb = b.end - b.start;
    if (la !== lb) return lb - la;
    return a.start - b.start;
  });
  const kept: PHISpanResponse[] = [];
  for (const span of all) {
    if (!hasOverlapWithKept(span, kept)) {
      kept.push(span);
    }
  }
  kept.sort((a, b) => a.start - b.start || a.end - b.end || a.label.localeCompare(b.label));
  return kept;
}

/** Stable key for a character range (same as traceConflicts.conflictRangeKey). */
export function spanRangeKey(start: number, end: number): string {
  return `${start}-${end}`;
}

/** Group spans that share identical [start, end). */
export function groupSpansByExactRange(spans: PHISpanResponse[]): Map<string, PHISpanResponse[]> {
  const m = new Map<string, PHISpanResponse[]>();
  for (const s of spans) {
    const k = spanRangeKey(s.start, s.end);
    const list = m.get(k) ?? [];
    list.push(s);
    m.set(k, list);
  }
  return m;
}

export interface SpanConflictSet {
  start: number;
  end: number;
  text: string;
  spans: PHISpanResponse[];
}

/**
 * Ranges where two or more spans share the same indices (possibly different labels).
 */
export function findConflictSets(
  spans: PHISpanResponse[],
  originalText: string,
): SpanConflictSet[] {
  const byRange = groupSpansByExactRange(spans);
  const out: SpanConflictSet[] = [];
  for (const [, list] of byRange) {
    if (list.length <= 1) continue;
    const uniqLabels = new Set(list.map((s) => s.label));
    if (uniqLabels.size <= 1) continue;
    const { start, end } = list[0]!;
    const text = originalText.slice(start, end);
    out.push({ start, end, text, spans: [...list] });
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

/** Lower index in CANONICAL_LABELS = higher priority for display / default primary. */
export function labelPriority(label: string): number {
  const i = CANONICAL_LABELS.indexOf(label as (typeof CANONICAL_LABELS)[number]);
  if (i >= 0) return i;
  return 1000 + label.charCodeAt(0);
}

export function sortSpansByPrimary(spans: PHISpanResponse[]): PHISpanResponse[] {
  return [...spans].sort((a, b) => labelPriority(a.label) - labelPriority(b.label));
}

export function pickPrimarySpan(spans: PHISpanResponse[]): PHISpanResponse {
  return sortSpansByPrimary(spans)[0]!;
}

/**
 * One span per exact range — the primary label wins for rendering the annotated source.
 */
export function dedupeSpansKeepPrimary(spans: PHISpanResponse[]): PHISpanResponse[] {
  const byRange = groupSpansByExactRange(spans);
  const out: PHISpanResponse[] = [];
  for (const list of byRange.values()) {
    out.push(pickPrimarySpan(list));
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

/** After resolution: remove every span at this range, then add the kept span. */
export function resolveConflictKeepSpan(
  spans: PHISpanResponse[],
  kept: PHISpanResponse,
): PHISpanResponse[] {
  const rk = spanRangeKey(kept.start, kept.end);
  const next = spans.filter((s) => spanRangeKey(s.start, s.end) !== rk);
  next.push(kept);
  next.sort((a, b) => a.start - b.start || a.end - b.end);
  return next;
}

/** After resolution: drop every span at this range — the user opted to keep none of the candidates. */
export function resolveConflictDropAll(
  spans: PHISpanResponse[],
  range: { start: number; end: number },
): PHISpanResponse[] {
  const rk = spanRangeKey(range.start, range.end);
  return spans.filter((s) => spanRangeKey(s.start, s.end) !== rk);
}

export function rangeHasUnresolvedConflict(
  conflictSets: SpanConflictSet[],
  start: number,
  end: number,
): boolean {
  return conflictSets.some((c) => c.start === start && c.end === end);
}
