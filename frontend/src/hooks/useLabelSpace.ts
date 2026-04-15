import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { computePipeLabels } from '../api/pipelines';

/**
 * Fetches the dynamic label space for a detector pipe, debounced so rapid
 * config edits don't flood the backend.  Merges dynamic results with
 * static ``baseLabels`` and any keys already present in ``currentMapping``.
 */
export function useLabelSpace(
  pipeType: string,
  config: Record<string, unknown>,
  baseLabels: string[],
  currentMapping: Record<string, unknown> | undefined,
) {
  const configWithoutMapping = useMemo(() => {
    const { label_mapping: _, ...rest } = config;
    return rest;
  }, [config]);

  const stableKey = useRef('');
  const serialized = JSON.stringify(configWithoutMapping);
  if (stableKey.current !== serialized) {
    stableKey.current = serialized;
  }

  const { data, isLoading } = useQuery({
    queryKey: ['pipe-labels', pipeType, stableKey.current],
    queryFn: () => computePipeLabels(pipeType, configWithoutMapping),
    staleTime: 30_000,
    enabled: !!pipeType,
  });

  const labels = useMemo(() => {
    const set = new Set<string>(baseLabels);
    if (data?.labels) {
      for (const l of data.labels) set.add(l);
    }
    if (currentMapping) {
      for (const k of Object.keys(currentMapping)) set.add(k);
    }
    return [...set].sort();
  }, [baseLabels, data, currentMapping]);

  return { labels, isLoading };
}
