import { useQuery } from '@tanstack/react-query';
import { fetchPipeReadiness, type PipeReadiness } from '../api/pipelines';

/**
 * Config-aware readiness lookup for a single pipe type. Used by the rail to
 * surface "model not downloaded" / "sidecar not running" badges before save.
 *
 * The query key includes the JSON-serialized config so toggling a model name
 * re-runs the check. Disabled until ``pipeType`` is set.
 */
export function usePipeReadiness(
  pipeType: string | null | undefined,
  config?: Record<string, unknown>,
) {
  return useQuery<PipeReadiness>({
    queryKey: ['pipe-readiness', pipeType ?? null, config ?? null],
    queryFn: () => fetchPipeReadiness(pipeType as string, config),
    enabled: Boolean(pipeType),
    staleTime: 30 * 1000,
  });
}
