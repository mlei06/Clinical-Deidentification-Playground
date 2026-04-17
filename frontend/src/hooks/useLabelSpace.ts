import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { usePipelineEditorStore } from '../stores/pipelineEditorStore';
import {
  computePipeLabels,
  fetchNeuronerLabelSpaceBundle,
  fetchPresidioLabelSpaceBundle,
} from '../api/pipelines';
import { usePipeEditorNodeId } from '../components/create/PipeEditorNodeContext';

/**
 * Fetches the dynamic label space for a detector pipe. Merges API results with
 * static ``baseLabels``.
 *
 * NeuroNER & Presidio: one GET ``label-space-bundle`` per pipe (per session); switching ``model``
 * or editing ``entity_map`` recomputes client-side (no POST on each change).
 *
 * Other detectors: POST ``/pipe-types/{name}/labels`` with config; catalog ``ui_base_labels`` is
 * not merged when that returns labels.
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

  /** Store-backed slice so POST /labels refetches even if RJSF hands widgets a stale ``config`` object. */
  const storeOverrideFingerprint = useMemo(() => {
    if (!selectedNodeId) return '';
    return [
      modelLive ?? '',
      entityMapLive ? JSON.stringify(entityMapLive) : '',
    ].join('|');
  }, [selectedNodeId, modelLive, entityMapLive]);

  const neuronerBundle = useQuery({
    queryKey: ['neuroner-label-space-bundle'],
    queryFn: () => fetchNeuronerLabelSpaceBundle(),
    staleTime: 5 * 60_000,
    enabled: pipeType === 'neuroner_ner',
  });

  const presidioBundle = useQuery({
    queryKey: ['presidio-label-space-bundle'],
    queryFn: () => fetchPresidioLabelSpaceBundle(),
    staleTime: 5 * 60_000,
    enabled: pipeType === 'presidio_ner',
  });

  const postLabels = useQuery({
    queryKey: ['pipe-labels', pipeType, configFingerprint, storeOverrideFingerprint],
    queryFn: () => computePipeLabels(pipeType, configWithoutMapping),
    staleTime: 30_000,
    enabled: !!pipeType && pipeType !== 'neuroner_ner' && pipeType !== 'presidio_ner',
  });

  const labels = useMemo(() => {
    // NeuroNER: raw manifest tags → entity_map → PHI names.
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

    // Presidio: bundle lists Presidio entity names per model (entity_map keys); same merge as above.
    if (pipeType === 'presidio_ner' && presidioBundle.data) {
      const bundle = presidioBundle.data;
      const modelName =
        modelLive ||
        (typeof config.model === 'string' && config.model) ||
        bundle.default_model;
      const keys = bundle.labels_by_model[modelName] ?? [];
      const defaultMap = bundle.default_entity_map;
      const userMap = entityMapLive ?? (config.entity_map as Record<string, string> | undefined) ?? {};
      const effectiveMap: Record<string, string> = { ...defaultMap, ...userMap };
      const set = new Set<string>();
      for (const k of keys) {
        set.add(effectiveMap[k] ?? k);
      }
      return [...set].sort();
    }

    if (pipeType === 'presidio_ner' && presidioBundle.isLoading) {
      return [...baseLabels].sort();
    }

    // POST /labels returns the full base label space for the current pipe config (e.g. presidio
    // model). Do not union with catalog ``ui_base_labels`` — those defaults are a fixed snapshot
    // (e.g. spaCy lg) and would hide model switches (same issue avoided for NeuroNER above).
    if (postLabels.data?.labels != null && postLabels.data.labels.length > 0) {
      return [...postLabels.data.labels].sort();
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
    presidioBundle.data,
    presidioBundle.isLoading,
    postLabels.data,
    config.model,
    config.entity_map,
    modelLive,
    entityMapLive,
  ]);

  const isLoading =
    pipeType === 'neuroner_ner'
      ? neuronerBundle.isLoading
      : pipeType === 'presidio_ner'
        ? presidioBundle.isLoading
        : postLabels.isLoading;

  return { labels, isLoading };
}
