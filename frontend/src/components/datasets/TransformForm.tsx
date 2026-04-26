import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDatasets, useDataset, useDatasetSchema, usePreviewTransform, useTransformDataset } from '../../hooks/useDatasets';
import { mappingRowsToRecord, type MappingRow } from './LabelMappingEditor';
import { defaultResplitRows, rowsToResplitPayload, type SplitPartRow } from './transform/DynamicResplitEditor';
import TransformFormHeader from './transform/TransformFormHeader';
import TransformSchemaTab from './transform/TransformSchemaTab';
import TransformSamplingTab from './transform/TransformSamplingTab';
import TransformPartitioningTab from './transform/TransformPartitioningTab';
import TransformImpactPreview from './transform/TransformImpactPreview';
import type { TransformPreviewRequest, TransformPreviewResponse, TransformRequest } from '../../api/types';

export interface TransformFormProps {
  sourceDataset?: string;
  onCreated: (name: string) => void;
}

type FilterMode = 'none' | 'keep' | 'drop';
export type TransformSubStep = 'schema' | 'sampling' | 'partitioning';

const SUB_STEPS: { id: TransformSubStep; label: string }[] = [
  { id: 'schema', label: 'Schema' },
  { id: 'sampling', label: 'Sampling' },
  { id: 'partitioning', label: 'Partitioning' },
];

function initialMappingRows(): MappingRow[] {
  return [];
}

function toSourceSplitsParam(splits: string[]): { source_splits?: string[] } {
  if (splits.length === 0) return {};
  return { source_splits: [...splits] };
}

export default function TransformForm({ sourceDataset, onCreated }: TransformFormProps) {
  const { data: datasets } = useDatasets();
  const mutation = useTransformDataset();
  const previewMutation = usePreviewTransform();
  const previewMutate = previewMutation.mutate;

  const [source, setSource] = useState(sourceDataset || '');
  const [targetSplits, setTargetSplits] = useState<string[]>([]);
  const [destinationMode, setDestinationMode] = useState<'in_place' | 'new'>('new');
  const [outputName, setOutputName] = useState('');
  const [description, setDescription] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('none');
  const [keepLabels, setKeepLabels] = useState<string[]>([]);
  const [dropLabels, setDropLabels] = useState<string[]>([]);
  const [mappingRows, setMappingRows] = useState<MappingRow[]>(initialMappingRows);
  /** Empty = no resize (keep all documents in the selected split scope). Otherwise exact target_documents. */
  const [subsetDocCount, setSubsetDocCount] = useState('');
  const [boostLabel, setBoostLabel] = useState('');
  const [boostExtraCopies, setBoostExtraCopies] = useState(0);
  const [ignoreExistingSplits, setIgnoreExistingSplits] = useState(false);
  const [resplitEnabled, setResplitEnabled] = useState(false);
  const [partRows, setPartRows] = useState<SplitPartRow[]>(defaultResplitRows);
  const [flattenTargetSplits, setFlattenTargetSplits] = useState(false);
  const [resplitShuffle, setResplitShuffle] = useState(true);
  const [transformSeed, setTransformSeed] = useState(42);
  const [previewResult, setPreviewResult] = useState<TransformPreviewResponse | null>(null);
  const [subStep, setSubStep] = useState<TransformSubStep>('schema');

  const { data: schema, isLoading: schemaLoading } = useDatasetSchema(source || null);
  const { data: sourceDatasetDetail, isLoading: sourceDetailLoading } = useDataset(source || null);
  const sourceDocCount = schema?.document_count ?? 0;
  const schemaLabels = schema?.labels ?? [];

  const targetSplitOptions = useMemo(() => {
    const c = sourceDatasetDetail?.split_document_counts;
    if (!c) return [] as { key: string; count: number }[];
    return Object.entries(c).map(([key, count]) => ({ key, count: Number(count) || 0 }));
  }, [sourceDatasetDetail?.split_document_counts]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!source) return;
    if (targetSplitOptions.length === 0) {
      setTargetSplits([]);
      return;
    }
    const allowed = new Set(targetSplitOptions.map((o) => o.key));
    setTargetSplits((prev) => {
      const next = prev.filter((k) => allowed.has(k));
      return next.length === prev.length ? prev : next;
    });
  }, [source, targetSplitOptions]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleKeepSelectionChange = useCallback((next: string[]) => {
    setKeepLabels(next);
    setDropLabels((d) => d.filter((x) => !next.includes(x)));
  }, []);
  const handleDropSelectionChange = useCallback((next: string[]) => {
    setDropLabels(next);
    setKeepLabels((k) => k.filter((x) => !next.includes(x)));
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (sourceDataset) setSource(sourceDataset);
  }, [sourceDataset]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const blockedForKeep = useMemo(() => new Set(dropLabels), [dropLabels]);
  const blockedForDrop = useMemo(() => new Set(keepLabels), [keepLabels]);
  const labelMapping = useMemo(() => mappingRowsToRecord(mappingRows), [mappingRows]);
  const mappingSources = useMemo(
    () => new Set(mappingRows.map((r) => r.fromLabel.trim()).filter(Boolean)),
    [mappingRows],
  );
  const dropMappingConflict = useMemo(
    () => dropLabels.filter((l) => mappingSources.has(l)),
    [dropLabels, mappingSources],
  );
  const clientConflicts = useMemo(() => {
    const msgs: string[] = [];
    for (const l of dropMappingConflict) {
      msgs.push(
        `Label ${l} is listed in Drop but also has a label mapping; drops apply before renaming.`,
      );
    }
    return msgs;
  }, [dropMappingConflict]);

  const suggestFrequentKeep = () => {
    if (!schema?.labels.length) return;
    const top = [...schema.labels]
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 8)
      .map((x) => x.label);
    setFilterMode('keep');
    setKeepLabels(top);
    setDropLabels((d) => d.filter((x) => !top.includes(x)));
  };

  const handleSourceChange = (v: string) => {
    setSource(v);
    setTargetSplits([]);
    setDestinationMode('new');
    setKeepLabels([]);
    setDropLabels([]);
    setMappingRows(initialMappingRows());
    setPreviewResult(null);
    setFilterMode('none');
    setSubsetDocCount('');
    setBoostLabel('');
    setBoostExtraCopies(0);
    setIgnoreExistingSplits(false);
    setResplitEnabled(false);
    setPartRows(defaultResplitRows());
    setFlattenTargetSplits(false);
    setResplitShuffle(true);
    setTransformSeed(42);
    setOutputName('');
    setDescription('');
  };

  const targetDocumentsForApi = useMemo(() => {
    const t = subsetDocCount.trim();
    if (!t) return undefined;
    const n = parseInt(t, 10);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }, [subsetDocCount]);

  const stripSplitsPartitioning = !resplitEnabled && ignoreExistingSplits;
  const inPlace = destinationMode === 'in_place';

  const previewRequest: TransformPreviewRequest | null = useMemo(() => {
    if (!source) return null;
    const seed = transformSeed;
    if (subStep === 'schema') {
      const drop = filterMode === 'drop' && dropLabels.length ? [...dropLabels] : undefined;
      const keep = filterMode === 'keep' && keepLabels.length ? [...keepLabels] : undefined;
      return {
        source_dataset: source,
        in_place: inPlace,
        ...toSourceSplitsParam(targetSplits),
        transform_mode: 'schema',
        drop_labels: drop,
        keep_labels: keep,
        label_mapping: labelMapping,
        seed,
      };
    }
    if (subStep === 'sampling') {
      return {
        source_dataset: source,
        in_place: inPlace,
        ...toSourceSplitsParam(targetSplits),
        transform_mode: 'sampling',
        target_documents: targetDocumentsForApi,
        boost_label: boostLabel.trim() || undefined,
        boost_extra_copies: boostLabel.trim() && boostExtraCopies > 0 ? boostExtraCopies : undefined,
        seed,
      };
    }
    return {
      source_dataset: source,
      in_place: inPlace,
      ...toSourceSplitsParam(targetSplits),
      transform_mode: 'partitioning',
      resplit: resplitEnabled ? rowsToResplitPayload(partRows) : undefined,
      strip_splits: stripSplitsPartitioning || undefined,
      flatten_target_splits: resplitEnabled ? flattenTargetSplits : false,
      resplit_shuffle: resplitEnabled ? resplitShuffle : true,
      seed,
    };
  }, [
    source,
    inPlace,
    subStep,
    targetSplits,
    filterMode,
    dropLabels,
    keepLabels,
    labelMapping,
    targetDocumentsForApi,
    boostLabel,
    boostExtraCopies,
    resplitEnabled,
    partRows,
    stripSplitsPartitioning,
    flattenTargetSplits,
    resplitShuffle,
    transformSeed,
  ]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!previewRequest) {
      setPreviewResult(null);
      return;
    }
    const debounceMs = subStep === 'sampling' ? 100 : 450;
    const t = window.setTimeout(() => {
      previewMutate(previewRequest, {
        onSuccess: (data) => setPreviewResult(data),
        onError: () => setPreviewResult(null),
      });
    }, debounceMs);
    return () => window.clearTimeout(t);
  }, [previewRequest, previewMutate, subStep]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleRefreshPreview = useCallback(() => {
    if (!previewRequest) return;
    previewMutate(previewRequest, {
      onSuccess: (data) => setPreviewResult(data),
      onError: () => setPreviewResult(null),
    });
  }, [previewRequest, previewMutate]);

  const canSubmit = useMemo(() => {
    if (subStep === 'schema') return dropMappingConflict.length === 0;
    if (subStep === 'partitioning' && resplitEnabled) {
      const p = rowsToResplitPayload(partRows);
      return p !== undefined;
    }
    return true;
  }, [subStep, dropMappingConflict, resplitEnabled, partRows]);

  const handleExecute = useCallback(() => {
    if (!source || !previewRequest || !canSubmit) return;
    if (!inPlace && !outputName.trim()) return;
    const boost =
      subStep === 'sampling' && boostLabel.trim() && boostExtraCopies > 0 ? boostExtraCopies : 0;
    const body: TransformRequest = {
      ...previewRequest,
      in_place: inPlace,
      output_name: inPlace ? (source as string) : outputName.trim(),
      description: description.trim() || undefined,
      boost_extra_copies: boost,
    };
    mutation.mutate(
      body,
      {
        onSuccess: (d) => {
          onCreated(d.name);
          setOutputName('');
          setDescription('');
          setKeepLabels([]);
          setDropLabels([]);
          setMappingRows(initialMappingRows());
          setSubsetDocCount('');
          setBoostLabel('');
          setBoostExtraCopies(0);
          setIgnoreExistingSplits(false);
          setFilterMode('none');
          setResplitEnabled(false);
          setPartRows(defaultResplitRows());
          setPreviewResult(null);
          setTargetSplits([]);
          setDestinationMode('new');
        },
      },
    );
  }, [source, outputName, previewRequest, canSubmit, description, mutation, onCreated, inPlace, subStep, boostLabel, boostExtraCopies]);

  const dropFieldInvalid = dropMappingConflict.length > 0;

  /** Document count in scope for the header’s target splits (from `split_document_counts`), or full corpus when no split filter. */
  const workSetDocumentCountFromHeader = useMemo(() => {
    if (targetSplits.length === 0) {
      return sourceDocCount;
    }
    if (targetSplitOptions.length === 0) {
      return null;
    }
    return targetSplits.reduce((acc, key) => {
      const o = targetSplitOptions.find((x) => x.key === key);
      return acc + (o?.count ?? 0);
    }, 0);
  }, [targetSplits, targetSplitOptions, sourceDocCount]);

  /**
   * Documents in source_splits scope; match header when preview is loading. Preview (server) when idle.
   */
  const workSetDocumentCount = useMemo(() => {
    const fromHeader = workSetDocumentCountFromHeader;
    const fromPreview = previewResult?.source_document_count;
    if (previewMutation.isPending) {
      // Do not use a stale fromPreview from before the last split/scope change.
      return fromHeader != null ? fromHeader : sourceDocCount;
    }
    if (fromPreview != null) {
      return fromPreview;
    }
    return fromHeader ?? sourceDocCount;
  }, [
    workSetDocumentCountFromHeader,
    previewResult?.source_document_count,
    previewMutation.isPending,
    sourceDocCount,
  ]);

  const partitionDocHint = workSetDocumentCount;
  const previewServerConflicts = previewResult?.conflicts ?? [];
  const submitLabel =
    subStep === 'schema' ? 'Execute schema' : subStep === 'sampling' ? 'Execute sampling' : 'Execute partitioning';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-500">Transform dataset</h4>
      <p className="mb-2 text-xs text-gray-500">
        Set source, target splits, and whether to overwrite or create a new dataset; each tab only runs that step. Preview
        and execute use the active tab and the header scope.
      </p>

      <TransformFormHeader
        datasets={datasets}
        source={source}
        onSourceChange={handleSourceChange}
        targetSplitOptions={targetSplitOptions}
        targetSplits={targetSplits}
        onTargetSplitsChange={setTargetSplits}
        detailLoading={sourceDetailLoading}
        destinationMode={destinationMode}
        onDestinationModeChange={setDestinationMode}
        outputName={outputName}
        onOutputNameChange={setOutputName}
        description={description}
        onDescriptionChange={setDescription}
        schemaLoading={schemaLoading}
        schema={schema}
      />

      <div
        className="mb-3 flex flex-wrap gap-0 border-b border-gray-200"
        role="tablist"
        aria-label="Transform configuration steps"
      >
        {SUB_STEPS.map((s) => {
          const active = subStep === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSubStep(s.id)}
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <div className="min-h-[12rem] space-y-4" role="tabpanel">
        {subStep === 'schema' && (
          <TransformSchemaTab
            source={source}
            filterMode={filterMode}
            onFilterModeChange={setFilterMode}
            keepLabels={keepLabels}
            onKeepSelectionChange={handleKeepSelectionChange}
            dropLabels={dropLabels}
            onDropSelectionChange={handleDropSelectionChange}
            schema={schema}
            schemaLoading={schemaLoading}
            schemaLabels={schemaLabels}
            suggestFrequentKeep={suggestFrequentKeep}
            mappingRows={mappingRows}
            onMappingRowsChange={setMappingRows}
            blockedForKeep={blockedForKeep}
            blockedForDrop={blockedForDrop}
            dropFieldInvalid={dropFieldInvalid}
            dropMappingConflict={dropMappingConflict}
            clientConflicts={clientConflicts}
          />
        )}

        {subStep === 'sampling' && (
          <TransformSamplingTab
            source={source}
            sourceDocCount={sourceDocCount}
            workDocumentCount={workSetDocumentCount}
            schemaLoading={schemaLoading}
            schemaLabels={schemaLabels}
            targetDocumentCount={subsetDocCount}
            onTargetDocumentCountChange={setSubsetDocCount}
            transformSeed={transformSeed}
            onTransformSeedChange={setTransformSeed}
            boostLabel={boostLabel}
            onBoostLabelChange={setBoostLabel}
            boostExtraCopies={boostExtraCopies}
            onBoostExtraCopiesChange={setBoostExtraCopies}
            boostVsKeepWarning={null}
            previewResult={previewResult}
            previewPending={previewMutation.isPending}
            previewServerConflicts={previewServerConflicts}
            inPlace={inPlace}
            outputName={outputName}
            canSubmit={canSubmit}
            onExecute={handleExecute}
            onRefreshPreview={handleRefreshPreview}
            transformPending={mutation.isPending}
            previewError={previewMutation.isError ? (previewMutation.error as Error) : null}
            transformError={mutation.isError ? (mutation.error as Error) : null}
          />
        )}

        {subStep === 'partitioning' && (
          <TransformPartitioningTab
            source={source}
            resplitEnabled={resplitEnabled}
            onResplitEnabledChange={setResplitEnabled}
            partRows={partRows}
            onPartRowsChange={setPartRows}
            partitioningDocHint={partitionDocHint}
            ignoreExistingSplits={ignoreExistingSplits}
            onIgnoreExistingSplitsChange={setIgnoreExistingSplits}
            flattenTargetSplits={flattenTargetSplits}
            onFlattenTargetSplitsChange={setFlattenTargetSplits}
            resplitShuffle={resplitShuffle}
            onResplitShuffleChange={setResplitShuffle}
            transformSeed={transformSeed}
            onTransformSeedChange={setTransformSeed}
          />
        )}

        {source && subStep !== 'sampling' && (
          <TransformImpactPreview
            mode={subStep}
            source={source}
            inPlace={inPlace}
            outputName={outputName}
            canSubmit={canSubmit}
            onSubmit={handleExecute}
            onRefreshPreview={handleRefreshPreview}
            previewResult={previewResult}
            previewServerConflicts={previewServerConflicts}
            previewPending={previewMutation.isPending}
            transformPending={mutation.isPending}
            previewError={previewMutation.isError ? (previewMutation.error as Error) : null}
            transformError={mutation.isError ? (mutation.error as Error) : null}
            submitLabel={submitLabel}
          />
        )}
      </div>
    </div>
  );
}
