import { useCallback, useRef, useState } from 'react';
import { redactDocument } from '../../api/production';
import {
  getCachedOutput,
  hashAnnotations,
  hashSourceText,
  putCachedOutput,
} from '../../lib/outputCache';
import type { Dataset, DatasetFile, ExportOutputType } from './store';
import type { EntitySpanResponse } from '../../api/types';

const CONCURRENCY = 4;

export type FileBatchStatus = 'pending' | 'running' | 'ok' | 'error';

export interface FileBatchResult {
  status: FileBatchStatus;
  error?: string;
  /** Source text used for the produced output. */
  text?: string;
  /** Spans aligned to ``text`` (annotated mode = original spans, redacted = [], surrogate = aligned). */
  spans?: EntitySpanResponse[];
  /** Snapshot of the original-file annotations that produced this result, for export metadata. */
  annotationsAtGenerate?: EntitySpanResponse[];
}

export interface BatchProgress {
  done: number;
  total: number;
}

interface RunArgs {
  dataset: Dataset;
  files: DatasetFile[];
  outputType: ExportOutputType;
  /** Per-export seed; falls back to file/dataset seed when omitted. */
  seedOverride?: string;
  reviewer: string;
}

/** Stable string→int mapping so a free-text seed becomes a number for the API. */
function seedStringToInt(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h & 0x7fffffff;
}

function modeKey(t: ExportOutputType): 'redacted' | 'surrogate' | null {
  if (t === 'redacted') return 'redacted';
  if (t === 'surrogate_annotated') return 'surrogate';
  return null;
}

export function useBatchGenerate() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BatchProgress>({ done: 0, total: 0 });
  const [results, setResults] = useState<Record<string, FileBatchResult>>({});
  const cancelRef = useRef(false);

  const reset = useCallback(() => {
    setResults({});
    setProgress({ done: 0, total: 0 });
  }, []);

  const run = useCallback(
    async ({ dataset, files, outputType, seedOverride, reviewer }: RunArgs) => {
      if (files.length === 0) return;
      const mode = modeKey(outputType);
      const datasetSeed = seedOverride ?? dataset.defaultSurrogateSeed ?? '0';

      setRunning(true);
      cancelRef.current = false;
      setProgress({ done: 0, total: files.length });
      // Seed the result map so the UI can render every selected file as pending.
      setResults(() => {
        const next: Record<string, FileBatchResult> = {};
        for (const f of files) next[f.id] = { status: 'pending' };
        return next;
      });

      const queue = [...files];
      let done = 0;

      const update = (id: string, patch: FileBatchResult) =>
        setResults((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

      const worker = async (): Promise<void> => {
        while (!cancelRef.current) {
          const file = queue.shift();
          if (!file) return;
          update(file.id, { status: 'running' });

          try {
            const annotationsAtGenerate = file.annotations.map((s) => ({ ...s }));

            // Annotated mode: no API call. Output text = original, spans = annotations.
            if (mode == null) {
              update(file.id, {
                status: 'ok',
                text: file.originalText,
                spans: annotationsAtGenerate,
                annotationsAtGenerate,
              });
              done += 1;
              setProgress({ done, total: files.length });
              continue;
            }

            const seed = file.surrogateSeed ?? datasetSeed;
            const textHash = hashSourceText(file.originalText);
            const annotationsHash = hashAnnotations(file.annotations);

            // Empty annotations: short-circuit; no point asking the API.
            if (file.annotations.length === 0) {
              update(file.id, {
                status: 'ok',
                text: file.originalText,
                spans: [],
                annotationsAtGenerate,
              });
              putCachedOutput({
                datasetId: dataset.id,
                fileId: file.id,
                textHash,
                annotationsHash,
                mode,
                seed,
                value: {
                  text: file.originalText,
                  spans: [],
                  generatedAt: new Date().toISOString(),
                },
              });
              done += 1;
              setProgress({ done, total: files.length });
              continue;
            }

            const hit = getCachedOutput({ textHash, annotationsHash, mode, seed });
            if (hit) {
              update(file.id, {
                status: 'ok',
                text: hit.text,
                spans: hit.spans,
                annotationsAtGenerate,
              });
              done += 1;
              setProgress({ done, total: files.length });
              continue;
            }

            const res = await redactDocument(
              {
                text: file.originalText,
                spans: file.annotations.map((s) => ({
                  start: s.start,
                  end: s.end,
                  label: s.label,
                })),
                output_mode: mode === 'redacted' ? 'redacted' : 'surrogate',
                include_surrogate_spans: mode === 'surrogate',
                surrogate_consistency: true,
                surrogate_seed: mode === 'surrogate' ? seedStringToInt(seed) : null,
              },
              reviewer || 'production-ui',
            );

            const value =
              mode === 'redacted'
                ? {
                    text: res.output_text,
                    spans: [] as EntitySpanResponse[],
                    generatedAt: new Date().toISOString(),
                  }
                : {
                    text: res.surrogate_text ?? res.output_text,
                    spans: (res.surrogate_spans ?? []).map((s) => ({ ...s })),
                    generatedAt: new Date().toISOString(),
                  };
            putCachedOutput({
              datasetId: dataset.id,
              fileId: file.id,
              textHash,
              annotationsHash,
              mode,
              seed,
              value,
            });
            update(file.id, {
              status: 'ok',
              text: value.text,
              spans: value.spans,
              annotationsAtGenerate,
            });
          } catch (err) {
            update(file.id, {
              status: 'error',
              error: err instanceof Error ? err.message : 'generation failed',
            });
          }
          done += 1;
          setProgress({ done, total: files.length });
        }
      };

      const workers: Promise<void>[] = [];
      for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
        workers.push(worker());
      }
      await Promise.all(workers);
      setRunning(false);
    },
    [],
  );

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  return { run, cancel, running, progress, results, reset };
}
