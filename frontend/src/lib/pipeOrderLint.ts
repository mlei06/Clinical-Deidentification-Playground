import type { PipelineSequenceEntry } from './pipelineToSequence';
import type { PipeTypeInfo } from '../api/types';

/**
 * Returns a short human-readable warning when inserting *candidate* at
 * *insertIndex* would put the pipeline in an unusual order — or null when
 * the placement looks fine. The user can still proceed; this is advisory.
 *
 * Heuristics are deliberately small and conservative; bigger correctness
 * checks live on the backend at validation/save time.
 */
export function lintPipeInsertion(
  currentPipes: PipelineSequenceEntry[],
  insertIndex: number,
  candidate: PipeTypeInfo,
): string | null {
  const upstream = currentPipes.slice(0, insertIndex);
  const downstream = currentPipes.slice(insertIndex);
  const upstreamRoles = new Set(upstream.map((p) => p.data.role));
  const upstreamNames = upstream.map((p) => p.data.pipeType);
  const downstreamNames = downstream.map((p) => p.data.pipeType);

  if (candidate.role === 'detector' && upstreamNames.includes('resolve_spans')) {
    return 'Detectors normally run before resolve_spans.';
  }

  if (
    (candidate.name === 'resolve_spans' || candidate.name === 'consistency_propagator') &&
    !upstreamRoles.has('detector')
  ) {
    return 'Add at least one detector earlier in the pipeline.';
  }

  if (
    (candidate.name === 'label_mapper' || candidate.name === 'label_filter') &&
    !upstreamRoles.has('detector')
  ) {
    return 'Detectors normally run before label_mapper / label_filter.';
  }

  if (candidate.name === 'resolve_spans' && downstreamNames.includes('resolve_spans')) {
    return 'Pipeline already contains resolve_spans further down.';
  }
  if (candidate.name === 'resolve_spans' && upstreamNames.includes('resolve_spans')) {
    return 'Pipeline already contains an earlier resolve_spans.';
  }

  if (candidate.role === 'preprocessor' && upstreamRoles.has('detector')) {
    return 'Preprocessors normally run before any detector.';
  }

  return null;
}
