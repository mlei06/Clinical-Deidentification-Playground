import type { EntitySpanResponse } from '../api/types';
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

function overlaps(a: EntitySpanResponse, b: EntitySpanResponse): boolean {
  return a.start < b.end && b.start < a.end;
}

function hasOverlapWithKept(span: EntitySpanResponse, kept: EntitySpanResponse[]): boolean {
  return kept.some((k) => overlaps(span, k));
}

/**
 * Same greedy merge as ``merge_label_priority`` / ``apply_resolve_spans(..., strategy="label_priority")``.
 * Higher-priority labels (earlier in *labelPriority*) win; ties break by longer span, then leftmost.
 */
export function mergeLabelPrioritySpans(
  spans: EntitySpanResponse[],
  labelPriority: string[] = RESOLVE_SPANS_LABEL_PRIORITY,
): EntitySpanResponse[] {
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
  const kept: EntitySpanResponse[] = [];
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
export function groupSpansByExactRange(spans: EntitySpanResponse[]): Map<string, EntitySpanResponse[]> {
  const m = new Map<string, EntitySpanResponse[]>();
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
  spans: EntitySpanResponse[];
}

/**
 * Ranges where two or more spans share the same indices (possibly different labels).
 */
export function findConflictSets(
  spans: EntitySpanResponse[],
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

export function sortSpansByPrimary(spans: EntitySpanResponse[]): EntitySpanResponse[] {
  return [...spans].sort((a, b) => labelPriority(a.label) - labelPriority(b.label));
}

export function pickPrimarySpan(spans: EntitySpanResponse[]): EntitySpanResponse {
  return sortSpansByPrimary(spans)[0]!;
}

/**
 * One span per exact range — the primary label wins for rendering the annotated source.
 */
export function dedupeSpansKeepPrimary(spans: EntitySpanResponse[]): EntitySpanResponse[] {
  const byRange = groupSpansByExactRange(spans);
  const out: EntitySpanResponse[] = [];
  for (const list of byRange.values()) {
    out.push(pickPrimarySpan(list));
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

/** After resolution: remove every span at this range, then add the kept span. */
export function resolveConflictKeepSpan(
  spans: EntitySpanResponse[],
  kept: EntitySpanResponse,
): EntitySpanResponse[] {
  const rk = spanRangeKey(kept.start, kept.end);
  const next = spans.filter((s) => spanRangeKey(s.start, s.end) !== rk);
  next.push(kept);
  next.sort((a, b) => a.start - b.start || a.end - b.end);
  return next;
}

/** After resolution: drop every span at this range — the user opted to keep none of the candidates. */
export function resolveConflictDropAll(
  spans: EntitySpanResponse[],
  range: { start: number; end: number },
): EntitySpanResponse[] {
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
