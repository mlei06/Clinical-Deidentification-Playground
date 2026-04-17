import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { usePipelineEditorStore } from '../stores/pipelineEditorStore';
import { computePipeLabels, fetchNeuronerLabelSpaceBundle } from '../api/pipelines';
import { usePipeEditorNodeId } from '../components/create/PipeEditorNodeContext';

/**
 * Fetches the dynamic label space for a detector pipe. Merges API results with
 * static ``baseLabels``.
 *
 * NeuroNER: one GET returns manifest labels for every model plus ``default_entity_map``;
 * switching ``model`` or editing ``entity_map`` recomputes client-side (no extra requests).
 */
export type UseLabelSpaceOptions = {
  /** When set, ``model`` / ``entity_map`` are read from the store so CoNLL vs i2b2 updates even if RJSF skips re-rendering this field. */
  selectedNodeId?: string;
};

export function useLabelSpace(
  pipeType: string,
  config: Record<string, unknown>,
  baseLabels: string[],
  _currentMapping: Record<string, unknown> | undefined,
  options?: UseLabelSpaceOptions,
) {
  const ctxNodeId = usePipeEditorNodeId();
  const selectedNodeId = options?.selectedNodeId ?? ctxNodeId;

  type StoreState = ReturnType<typeof usePipelineEditorStore.getState>;

  const selectModel = useCallback(
    (s: StoreState) => {
      if (!selectedNodeId) return undefined;
      const m = s.nodes.find((n) => n.id === selectedNodeId)?.data.config?.model;
      return typeof m === 'string' ? m : undefined;
    },
    [selectedNodeId],
  );

  const selectEntityMap = useCallback(
    (s: StoreState) => {
      if (!selectedNodeId) return undefined;
      const em = s.nodes.find((n) => n.id === selectedNodeId)?.data.config?.entity_map;
      return em && typeof em === 'object' && !Array.isArray(em)
        ? (em as Record<string, string>)
        : undefined;
    },
    [selectedNodeId],
  );

  const modelLive = usePipelineEditorStore(selectModel);

  const entityMapLive = usePipelineEditorStore(selectEntityMap);

  const configFingerprint = JSON.stringify(config);

  const configWithoutMapping = useMemo(() => {
    const { label_mapping: _, ...rest } = config;
    return rest;
  }, [configFingerprint, config]);

  const neuronerBundle = useQuery({
    queryKey: ['neuroner-label-space-bundle'],
    queryFn: () => fetchNeuronerLabelSpaceBundle(),
    staleTime: 5 * 60_000,
    enabled: pipeType === 'neuroner_ner',
  });

  const postLabels = useQuery({
    queryKey: ['pipe-labels', pipeType, configFingerprint],
    queryFn: () => computePipeLabels(pipeType, configWithoutMapping),
    staleTime: 30_000,
    enabled: !!pipeType && pipeType !== 'neuroner_ner',
  });

  const labels = useMemo(() => {
    // NeuroNER: do NOT merge catalog baseLabels (static ~11 canonical types from pipe-types).
    // Those are injected as ui_base_labels on the schema and would make the list look identical
    // for every model. Only the bundle + selected model + entity_map define the space.
    if (pipeType === 'neuroner_ner' && neuronerBundle.data) {
      const bundle = neuronerBundle.data;
      const modelName =
        modelLive ||
        (typeof config.model === 'string' && config.model) ||
        bundle.default_model;
      const raw = bundle.labels_by_model[modelName] ?? [];
      const defaultMap = bundle.default_entity_map;
      const userMap = entityMapLive ?? (config.entity_map as Record<string, string> | undefined) ?? {};
      const effectiveMap: Record<string, string> = { ...defaultMap, ...userMap };
      const set = new Set<string>();
      for (const r of raw) {
        set.add(effectiveMap[r] ?? r);
      }
      return [...set].sort();
    }

    if (pipeType === 'neuroner_ner' && neuronerBundle.isLoading) {
      return [...baseLabels].sort();
    }

    const set = new Set<string>(baseLabels);
    if (postLabels.data?.labels) {
      for (const l of postLabels.data.labels) set.add(l);
    }
    return [...set].sort();
  }, [
    baseLabels,
    pipeType,
    neuronerBundle.data,
    neuronerBundle.isLoading,
    postLabels.data,
    config.model,
    config.entity_map,
    modelLive,
    entityMapLive,
  ]);

  const isLoading =
    pipeType === 'neuroner_ner' ? neuronerBundle.isLoading : postLabels.isLoading;

  return { labels, isLoading };
}
