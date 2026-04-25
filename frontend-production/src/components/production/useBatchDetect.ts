import { useCallback, useRef, useState } from 'react';
import { inferText } from '../../api/production';
import { useProductionStore } from './store';

const CONCURRENCY = 4;

interface RunArgs {
  datasetId: string;
  fileIds: string[];
  target: string;
  reviewer: string;
  /**
   * Whether to clear `resolved` on any re-detected file. Default true per §4.1
   * of the design spec — re-detection replaces annotations, so the reviewer
   * must re-confirm quality.
   */
  clearResolved?: boolean;
}

/**
 * Selection-based detection per docs/design/production-ui-assisted-ner-datasets.md §4.1.
 * Runs `POST /process/{target}` for each selected file and REPLACES annotations
 * on success (no merging with previous spans or human edits).
 */
export function useBatchDetect() {
  const updateFile = useProductionStore((s) => s.updateFile);
  const replaceFileAnnotations = useProductionStore((s) => s.replaceFileAnnotations);
  const datasets = useProductionStore((s) => s.datasets);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const cancelRef = useRef(false);

  const run = useCallback(
    async ({ datasetId, fileIds, target, reviewer, clearResolved = true }: RunArgs) => {
      if (!target || fileIds.length === 0) return;
      const ds = datasets[datasetId];
      if (!ds) return;
      const pickedIds = new Set(fileIds);
      const targets = ds.files.filter((f) => pickedIds.has(f.id));
      if (targets.length === 0) return;

      setRunning(true);
      cancelRef.current = false;
      setProgress({ done: 0, total: targets.length });

      const queue = [...targets];
      const workers: Promise<void>[] = [];
      let done = 0;

      const worker = async (): Promise<void> => {
        while (!cancelRef.current) {
          const file = queue.shift();
          if (!file) return;
          updateFile(datasetId, file.id, {
            detectionStatus: 'processing',
            error: undefined,
          });
          try {
            const res = await inferText(
              target,
              file.originalText,
              undefined,
              false,
              reviewer || 'production-ui',
              undefined,
            );
            replaceFileAnnotations(datasetId, file.id, res.spans, {
              target,
              processingTimeMs: res.processing_time_ms,
              clearResolved: clearResolved && file.resolved,
              surrogateText: null,
              annotationsOnSurrogate: null,
            });
          } catch (err) {
            updateFile(datasetId, file.id, {
              detectionStatus: 'error',
              error: err instanceof Error ? err.message : 'detection failed',
            });
          }
          done += 1;
          setProgress({ done, total: targets.length });
        }
      };

      for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
        workers.push(worker());
      }
      await Promise.all(workers);
      setRunning(false);
    },
    [datasets, replaceFileAnnotations, updateFile],
  );

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  return { run, cancel, running, progress };
}
