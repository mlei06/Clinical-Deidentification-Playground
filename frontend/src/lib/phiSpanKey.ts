import type { PHISpanResponse } from '../api/types';

/** Stable key for a span within a document (used for list ↔ highlight sync). */
export function phiSpanKey(s: PHISpanResponse): string {
  return `${s.start}-${s.end}-${s.label}`;
}

/** True if every character in [start, end) lies outside all spans (unflagged text). */
export function isRangeUncovered(
  start: number,
  end: number,
  spans: PHISpanResponse[],
): boolean {
  if (start >= end) return false;
  for (let i = start; i < end; i++) {
    if (spans.some((s) => s.start <= i && i < s.end)) return false;
  }
  return true;
}
