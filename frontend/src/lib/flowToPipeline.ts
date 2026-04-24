import type { PipelineConfig, PipeStep } from '../api/types';
import type { PipelineSequenceEntry } from './pipelineToSequence';

function stepFromEntry(entry: PipelineSequenceEntry): PipeStep {
  const step: PipeStep = { type: entry.data.pipeType };
  if (entry.data.config && Object.keys(entry.data.config).length > 0) {
    step.config = entry.data.config;
  }
  return step;
}

/**
 * Linear pipeline list → saved JSON. Order matches the sequence array.
 */
export function sequenceToPipelineConfig(
  entries: PipelineSequenceEntry[],
  options?: { description?: string },
): PipelineConfig {
  const out: PipelineConfig = { pipes: entries.map((e) => stepFromEntry(e)) };
  const d = options?.description?.trim();
  if (d) {
    out.description = d;
  }
  return out;
}
