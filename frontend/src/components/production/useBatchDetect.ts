import { useCallback, useRef, useState } from 'react';
import { processText } from '../../api/process';
import { useReviewQueue } from './store';

const CONCURRENCY = 4;

export function useBatchDetect(pipelineName: string | null, reviewer: string) {
  const { docs, updateDoc } = useReviewQueue();
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);

  const run = useCallback(async () => {
    if (!pipelineName) return;
    const pending = docs.filter((d) => d.status === 'pending');
    if (pending.length === 0) return;
    setRunning(true);
    cancelRef.current = false;

    const queue = [...pending];
    const workers: Promise<void>[] = [];
    const next = async (): Promise<void> => {
      while (!cancelRef.current) {
        const d = queue.shift();
        if (!d) return;
        updateDoc(d.id, { status: 'processing', error: undefined });
        try {
          const res = await processText(
            pipelineName,
            { text: d.text },
            false,
            'annotated',
            reviewer || 'production-ui',
          );
          updateDoc(d.id, {
            status: 'ready',
            detectedSpans: res.spans,
            editedSpans: res.spans,
            redactedText: res.redacted_text,
            processingTimeMs: res.processing_time_ms,
          });
        } catch (err) {
          updateDoc(d.id, {
            status: 'error',
            error: err instanceof Error ? err.message : 'detection failed',
          });
        }
      }
    };
    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
      workers.push(next());
    }
    await Promise.all(workers);
    setRunning(false);
  }, [pipelineName, reviewer, docs, updateDoc]);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  return { run, cancel, running };
}
