import type { EntitySpanResponse } from '../api/types';

/**
 * Memory-only output cache shared by the Annotate-tab preview column and the
 * Export-tab batch generator. Keyed by ``(textHash, annotationsHash, mode, seed)``
 * so the same `(file, mode, seed)` produces a stable cache hit across edits
 * that don't actually change the inputs.
 *
 * No persistence: contents are re-derivable from the current annotations on
 * any page load, and persisting them would re-introduce the staleness
 * machinery this redesign deletes.
 */

export type PreviewMode = 'redacted' | 'surrogate';

export interface CachedOutput {
  text: string;
  /** Aligned spans for surrogate mode; empty for redacted. */
  spans: EntitySpanResponse[];
  generatedAt: string;
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function hashSourceText(text: string): string {
  return `${text.length}:${fnv1a(text)}`;
}

export function hashAnnotations(spans: EntitySpanResponse[]): string {
  const parts = spans.map((s) => `${s.start}|${s.end}|${s.label}`).sort();
  return `${parts.length}:${fnv1a(parts.join('\n'))}`;
}

function makeKey(
  textHash: string,
  annotationsHash: string,
  mode: PreviewMode,
  seed: string,
): string {
  return `${textHash}|${annotationsHash}|${mode}|${seed}`;
}

const store = new Map<string, CachedOutput>();
const indexByFile = new Map<string, Set<string>>();
const indexByDataset = new Map<string, Set<string>>();

interface PutArgs {
  datasetId: string;
  fileId: string;
  textHash: string;
  annotationsHash: string;
  mode: PreviewMode;
  seed: string;
  value: CachedOutput;
}

export function putCachedOutput({
  datasetId,
  fileId,
  textHash,
  annotationsHash,
  mode,
  seed,
  value,
}: PutArgs): void {
  const key = makeKey(textHash, annotationsHash, mode, seed);
  store.set(key, value);
  let fileKeys = indexByFile.get(fileId);
  if (!fileKeys) {
    fileKeys = new Set();
    indexByFile.set(fileId, fileKeys);
  }
  fileKeys.add(key);
  let datasetKeys = indexByDataset.get(datasetId);
  if (!datasetKeys) {
    datasetKeys = new Set();
    indexByDataset.set(datasetId, datasetKeys);
  }
  datasetKeys.add(key);
}

interface GetArgs {
  textHash: string;
  annotationsHash: string;
  mode: PreviewMode;
  seed: string;
}

export function getCachedOutput({
  textHash,
  annotationsHash,
  mode,
  seed,
}: GetArgs): CachedOutput | null {
  return store.get(makeKey(textHash, annotationsHash, mode, seed)) ?? null;
}

export function invalidateCacheForFile(fileId: string): void {
  const keys = indexByFile.get(fileId);
  if (!keys) return;
  for (const k of keys) store.delete(k);
  indexByFile.delete(fileId);
  for (const datasetKeys of indexByDataset.values()) {
    for (const k of keys) datasetKeys.delete(k);
  }
}

export function invalidateCacheForDataset(datasetId: string): void {
  const keys = indexByDataset.get(datasetId);
  if (!keys) return;
  for (const k of keys) store.delete(k);
  indexByDataset.delete(datasetId);
  for (const [fileId, fileKeys] of indexByFile) {
    for (const k of keys) fileKeys.delete(k);
    if (fileKeys.size === 0) indexByFile.delete(fileId);
  }
}

/** Test helper — wipes everything. Production code shouldn't need this. */
export function __resetOutputCache(): void {
  store.clear();
  indexByFile.clear();
  indexByDataset.clear();
}
