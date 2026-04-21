import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Wand2, Telescope } from 'lucide-react';
import {
  useDatasets,
  useDatasetSchema,
  useTransformDataset,
  usePreviewTransform,
} from '../../hooks/useDatasets';
import LabelChipSelect from './LabelChipSelect';
import LabelMappingEditor, {
  mappingRowsToRecord,
  type MappingRow,
} from './LabelMappingEditor';
import ResplitControls, { buildResplitPayload } from './ResplitControls';
import SearchableLabelSelect from './SearchableLabelSelect';
import type { TransformPreviewResponse } from '../../api/types';

interface TransformFormProps {
  sourceDataset?: string;
  onCreated: (name: string) => void;
}

type FilterMode = 'none' | 'keep' | 'drop';

type ResizeMode = 'all' | 'subset';

function initialMappingRows(): MappingRow[] {
  return [];
}

const BOOST_COPY_PRESETS = [0, 1, 2, 5, 10] as const;

export default function TransformForm({ sourceDataset, onCreated }: TransformFormProps) {
  const { data: datasets } = useDatasets();
  const mutation = useTransformDataset();
  const previewMutation = usePreviewTransform();
  /** Mutation object identity changes with status; ``mutate`` is stable (TanStack Query). */
  const previewMutate = previewMutation.mutate;

  const [source, setSource] = useState(sourceDataset || '');
  const [sourceSplits, setSourceSplits] = useState('');
  const [outputName, setOutputName] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('none');
  const [keepLabels, setKeepLabels] = useState<string[]>([]);
  const [dropLabels, setDropLabels] = useState<string[]>([]);
  const [mappingRows, setMappingRows] = useState<MappingRow[]>(initialMappingRows);

  const [resizeMode, setResizeMode] = useState<ResizeMode>('all');
  const [subsetDocCount, setSubsetDocCount] = useState('');

  const [boostLabel, setBoostLabel] = useState('');
  const [boostExtraCopies, setBoostExtraCopies] = useState(0);

  const [ignoreExistingSplits, setIgnoreExistingSplits] = useState(false);
  const [description, setDescription] = useState('');

  const [resplitEnabled, setResplitEnabled] = useState(false);
  const [{ boundary1Pct, boundary2Pct }, setSplitPct] = useState({
    boundary1Pct: 70,
    boundary2Pct: 85,
  });

  const [previewResult, setPreviewResult] = useState<TransformPreviewResponse | null>(null);

  const { data: schema, isLoading: schemaLoading } = useDatasetSchema(source || null);

  const sourceDocCount = schema?.document_count ?? 0;

  useEffect(() => {
    if (sourceDataset) setSource(sourceDataset);
  }, [sourceDataset]);

  const schemaLabels = schema?.labels ?? [];
  const blockedForKeep = useMemo(() => new Set(dropLabels), [dropLabels]);
  const blockedForDrop = useMemo(() => new Set(keepLabels), [keepLabels]);

  const labelMapping = useMemo(() => mappingRowsToRecord(mappingRows), [mappingRows]);

  const mappingSources = useMemo(
    () => new Set(mappingRows.map((r) => r.fromLabel.trim()).filter(Boolean)),
    [mappingRows],
  );

  const dropMappingConflict = useMemo(() => {
    return dropLabels.filter((l) => mappingSources.has(l));
  }, [dropLabels, mappingSources]);

  const clientConflicts = useMemo(() => {
    const msgs: string[] = [];
    for (const l of dropMappingConflict) {
      msgs.push(
        `Label ${l} is listed in Drop but also has a label mapping; drops apply before renaming.`,
      );
    }
    return msgs;
  }, [dropMappingConflict]);

  const boostVsKeepWarning = useMemo(() => {
    if (filterMode !== 'keep' || !boostLabel.trim()) return null;
    if (keepLabels.length === 0) return null;
    if (!keepLabels.includes(boostLabel.trim())) {
      return `The oversampling label “${boostLabel}” is not in Keep labels, so spans with that label are removed before boosting and it will have no effect.`;
    }
    return null;
  }, [filterMode, boostLabel, keepLabels]);

  const handleBoundary1Change = useCallback((v: number) => {
    setSplitPct((s) => {
      const next1 = Math.max(0.5, Math.min(v, 99));
      let next2 = s.boundary2Pct;
      if (next1 >= next2 - 0.5) {
        next2 = Math.min(99.5, next1 + 1);
      }
      return { boundary1Pct: next1, boundary2Pct: next2 };
    });
  }, []);

  const handleBoundary2Change = useCallback((v: number) => {
    setSplitPct((s) => {
      const next2 = Math.min(99.5, Math.max(s.boundary1Pct + 0.5, v));
      return { ...s, boundary2Pct: next2 };
    });
  }, []);

  const handleSourceChange = (v: string) => {
    setSource(v);
    setSourceSplits('');
    setKeepLabels([]);
    setDropLabels([]);
    setMappingRows(initialMappingRows());
    setPreviewResult(null);
    setFilterMode('none');
    setResizeMode('all');
    setSubsetDocCount('');
    setBoostLabel('');
    setBoostExtraCopies(0);
    setIgnoreExistingSplits(false);
    setResplitEnabled(false);
    setSplitPct({ boundary1Pct: 70, boundary2Pct: 85 });
  };

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

  const targetDocumentsForApi = useMemo(() => {
    if (resizeMode === 'all') return undefined;
    const n = parseInt(subsetDocCount.trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }, [resizeMode, subsetDocCount]);

  const stripSplitsForApi = resplitEnabled ? false : ignoreExistingSplits;

  const sourceSplitsForApi = useMemo(() => {
    const parts = sourceSplits
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts : undefined;
  }, [sourceSplits]);

  const buildPreviewRequestBase = useCallback(() => {
    const drop =
      filterMode === 'drop' && dropLabels.length ? [...dropLabels] : undefined;
    const keep =
      filterMode === 'keep' && keepLabels.length ? [...keepLabels] : undefined;
    return {
      source_dataset: source,
      ...(sourceSplitsForApi ? { source_splits: sourceSplitsForApi } : {}),
      drop_labels: drop,
      keep_labels: keep,
      label_mapping: labelMapping,
      target_documents: targetDocumentsForApi,
      boost_label: boostLabel.trim() || undefined,
      boost_extra_copies:
        boostLabel.trim() && boostExtraCopies > 0 ? boostExtraCopies : undefined,
      resplit: buildResplitPayload(resplitEnabled, boundary1Pct, boundary2Pct),
      strip_splits: stripSplitsForApi || undefined,
      seed: 42,
    };
  }, [
    source,
    sourceSplitsForApi,
    filterMode,
    dropLabels,
    keepLabels,
    labelMapping,
    targetDocumentsForApi,
    boostLabel,
    boostExtraCopies,
    resplitEnabled,
    boundary1Pct,
    boundary2Pct,
    stripSplitsForApi,
  ]);

  const handlePreview = useCallback(() => {
    if (!source) return;
    previewMutate(buildPreviewRequestBase(), {
      onSuccess: (data) => setPreviewResult(data),
      onError: () => setPreviewResult(null),
    });
  }, [source, buildPreviewRequestBase, previewMutate]);

  const previewKey = useMemo(
    () => JSON.stringify(buildPreviewRequestBase()),
    [buildPreviewRequestBase],
  );

  useEffect(() => {
    if (!source) {
      setPreviewResult(null);
      return;
    }
    const t = window.setTimeout(() => {
      previewMutate(buildPreviewRequestBase(), {
        onSuccess: (data) => setPreviewResult(data),
        onError: () => setPreviewResult(null),
      });
    }, 480);
    return () => window.clearTimeout(t);
  }, [source, previewKey, previewMutate]);

  const handleSubmit = () => {
    if (!source || !outputName.trim()) return;
    if (dropMappingConflict.length) return;

    const base = buildPreviewRequestBase();
    mutation.mutate(
      {
        ...base,
        output_name: outputName.trim(),
        description: description.trim() || undefined,
        boost_extra_copies: base.boost_extra_copies ?? 0,
      },
      {
        onSuccess: (d) => {
          onCreated(d.name);
          setOutputName('');
          setKeepLabels([]);
          setDropLabels([]);
          setMappingRows(initialMappingRows());
          setResizeMode('all');
          setSubsetDocCount('');
          setBoostLabel('');
          setBoostExtraCopies(0);
          setIgnoreExistingSplits(false);
          setDescription('');
          setFilterMode('none');
          setResplitEnabled(false);
          setSplitPct({ boundary1Pct: 70, boundary2Pct: 85 });
          setPreviewResult(null);
        },
      },
    );
  };

  const dropFieldInvalid = dropMappingConflict.length > 0;

  const partitioningDocHint =
    previewResult?.projected_document_count ?? sourceDocCount;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">
        Transform Dataset
      </h4>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Source</label>
            <select
              value={source}
              onChange={(e) => handleSourceChange(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            >
              <option value="">Select dataset…</option>
              {datasets?.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name} ({d.document_count.toLocaleString()} docs)
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Output name</label>
            <input
              type="text"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              placeholder="transformed-corpus"
              className="w-44 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            />
          </div>
          {source && (
            <p className="text-xs text-gray-500">
              {schemaLoading
                ? 'Loading label schema…'
                : schema
                  ? `${schema.labels.length} unique labels, ${schema.total_spans.toLocaleString()} spans`
                  : ''}
            </p>
          )}
        </div>

        {source ? (
          <div className="flex max-w-xl flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">
              Source splits <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={sourceSplits}
              onChange={(e) => setSourceSplits(e.target.value)}
              placeholder="e.g. train, valid — comma-separated; matches metadata.split"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            />
          </div>
        ) : null}

        <div className="rounded-md border border-gray-100 bg-gray-50/50 p-3">
          <p className="mb-2 text-xs font-medium text-gray-600">Span filter</p>
          <div className="mb-3 flex flex-wrap gap-3 text-xs">
            {(['none', 'keep', 'drop'] as const).map((m) => (
              <label key={m} className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name="filterMode"
                  checked={filterMode === m}
                  onChange={() => {
                    setFilterMode(m);
                    if (m === 'keep') setDropLabels([]);
                    if (m === 'drop') setKeepLabels([]);
                  }}
                />
                {m === 'none' ? 'No filter' : m === 'keep' ? 'Keep only' : 'Drop'}
              </label>
            ))}
            {filterMode === 'keep' && schema && schema.labels.length > 0 && (
              <button
                type="button"
                onClick={suggestFrequentKeep}
                className="text-xs text-gray-700 underline decoration-gray-300 hover:text-gray-900"
              >
                Suggest frequent labels (top 8)
              </button>
            )}
          </div>

          {filterMode === 'keep' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">Keep labels</label>
              <LabelChipSelect
                idPrefix="keep"
                options={schemaLabels}
                value={keepLabels}
                onChange={(next) => {
                  setKeepLabels(next);
                  setDropLabels((d) => d.filter((x) => !next.includes(x)));
                }}
                blocked={blockedForKeep}
                disabled={!source || schemaLoading}
                onSelectAll={() => {
                  const all = schemaLabels.map((x) => x.label).filter((l) => !blockedForKeep.has(l));
                  setKeepLabels(all);
                  setDropLabels([]);
                }}
                onClearAll={() => setKeepLabels([])}
              />
            </div>
          )}

          {filterMode === 'drop' && (
            <div className="space-y-1">
              <label
                className={`text-xs font-medium ${dropFieldInvalid ? 'text-red-700' : 'text-gray-600'}`}
              >
                Drop labels
              </label>
              <LabelChipSelect
                idPrefix="drop"
                options={schemaLabels}
                value={dropLabels}
                onChange={(next) => {
                  setDropLabels(next);
                  setKeepLabels((k) => k.filter((x) => !next.includes(x)));
                }}
                blocked={blockedForDrop}
                disabled={!source || schemaLoading}
                onSelectAll={() => {
                  const all = schemaLabels.map((x) => x.label).filter((l) => !blockedForDrop.has(l));
                  setDropLabels(all);
                  setKeepLabels([]);
                }}
                onClearAll={() => setDropLabels([])}
              />
              {dropFieldInvalid && (
                <p className="text-xs text-red-600">
                  Remove these from Drop or delete the mapping:{' '}
                  {dropMappingConflict.join(', ')}
                </p>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Label mapping</label>
          <p className="mb-2 text-xs text-gray-500">
            Map source labels to target schema (applied after filtering).
          </p>
          <LabelMappingEditor
            schemaLabels={schemaLabels}
            rows={mappingRows}
            onChange={setMappingRows}
            highlightError={dropFieldInvalid}
            disabled={!source}
          />
        </div>

        {(clientConflicts.length > 0 || (previewResult?.conflicts?.length ?? 0) > 0) && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p className="font-medium">Warnings</p>
            <ul className="list-inside list-disc">
              {[...clientConflicts, ...(previewResult?.conflicts ?? [])].map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        {boostVsKeepWarning && (
          <div className="rounded-md border border-amber-300 bg-amber-50/90 px-3 py-2 text-xs text-amber-950">
            <p className="font-medium">Oversampling</p>
            <p>{boostVsKeepWarning}</p>
          </div>
        )}

        {/* Step 3: sampling & augmentation */}
        <section className="rounded-lg border border-gray-200 bg-gray-50/30 p-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h5 className="text-xs font-bold uppercase tracking-wider text-gray-600">
                Step 3 · Sampling &amp; augmentation
              </h5>
              <p className="mt-1 max-w-2xl text-xs text-gray-500">
                Tune corpus size, optionally oversample documents with rare entities, and assign splits. Preview
                updates as you adjust settings.
              </p>
            </div>
            <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 shadow-sm">
              <span className="font-medium text-gray-500">Original</span>
              <span className="font-mono">{sourceDocCount.toLocaleString()} docs</span>
              <span className="text-gray-400">→</span>
              <span className="font-medium text-gray-500">Projected</span>
              {previewMutation.isPending ? (
                <Loader2 size={14} className="animate-spin text-gray-500" />
              ) : (
                <span className="font-mono font-semibold text-gray-900">
                  {previewResult
                    ? `${previewResult.projected_document_count.toLocaleString()} docs`
                    : '—'}
                </span>
              )}
              {previewResult && (
                <span className="text-gray-400">
                  ({previewResult.projected_span_count.toLocaleString()} spans)
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-1">
            {/* Dataset resizing */}
            <div className="rounded-md border border-white bg-white p-4 shadow-sm">
              <h6 className="text-sm font-semibold text-gray-800">Dataset size</h6>
              <p className="mt-0.5 text-xs text-gray-500">Control how many documents are kept after filtering.</p>
              <div className="mt-3 flex flex-col gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="resizeMode"
                    checked={resizeMode === 'all'}
                    onChange={() => {
                      setResizeMode('all');
                      setSubsetDocCount('');
                    }}
                  />
                  <span>
                    Use all documents
                    {sourceDocCount > 0 && (
                      <span className="ml-1 text-xs text-gray-500">
                        ({sourceDocCount.toLocaleString()} in source after register)
                      </span>
                    )}
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="resizeMode"
                    className="mt-1"
                    checked={resizeMode === 'subset'}
                    onChange={() => setResizeMode('subset')}
                  />
                  <span className="flex flex-1 flex-col gap-1">
                    <span>Subset to a fixed count</span>
                    <input
                      type="number"
                      min={0}
                      disabled={resizeMode !== 'subset'}
                      value={subsetDocCount}
                      onChange={(e) => setSubsetDocCount(e.target.value)}
                      placeholder="e.g. 1500"
                      className="max-w-[12rem] rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
                    />
                  </span>
                </label>
              </div>
              {resizeMode === 'subset' && (
                <p className="mt-2 text-xs text-gray-500">
                  Uses random sampling (seed-fixed) to shrink or grow the corpus to the target size.
                </p>
              )}
            </div>

            {/* Class balancing */}
            <div className="rounded-md border border-white bg-white p-4 shadow-sm">
              <h6 className="text-sm font-semibold text-gray-800">Augment rare labels</h6>
              <p
                className="mt-0.5 text-xs text-gray-500"
                title="Duplicates are appended after resizing; each selected document that contains the label is copied extra times."
              >
                Select a minority class and add extra copies of matching documents to improve coverage (applied after
                resizing).
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-600">Label to boost</label>
                  <SearchableLabelSelect
                    options={schemaLabels}
                    value={boostLabel}
                    onChange={setBoostLabel}
                    disabled={!source || schemaLoading}
                    placeholder="Search source labels…"
                    id="boost-label-select"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-600">Extra copies per matching document</label>
                  <div className="flex flex-wrap gap-1.5">
                    {BOOST_COPY_PRESETS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        disabled={!boostLabel.trim()}
                        onClick={() => setBoostExtraCopies(p)}
                        className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                          boostExtraCopies === p
                            ? 'border-gray-900 bg-gray-900 text-white'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'
                        }`}
                      >
                        {p === 0 ? 'Off' : `${p}×`}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400">
                    “1×” = one duplicate per hit document (+100% exposure for those docs).
                  </p>
                </div>
              </div>
            </div>

            <ResplitControls
              resplitEnabled={resplitEnabled}
              onResplitEnabledChange={(on) => {
                setResplitEnabled(on);
                if (on) setIgnoreExistingSplits(false);
              }}
              boundary1Pct={boundary1Pct}
              boundary2Pct={boundary2Pct}
              onBoundary1Change={handleBoundary1Change}
              onBoundary2Change={handleBoundary2Change}
              sourceDocCount={partitioningDocHint}
              ignoreExistingSplits={ignoreExistingSplits}
              onIgnoreExistingSplitsChange={setIgnoreExistingSplits}
            />
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-4">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none sm:w-64"
          />
        </div>

        {previewResult && (
          <div className="overflow-x-auto rounded-md border border-gray-200 bg-white text-xs">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-3 py-2 font-medium">Metric</th>
                  <th className="px-3 py-2 font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="px-3 py-1.5">Spans dropped (filter)</td>
                  <td className="px-3 py-1.5 font-mono">
                    {previewResult.spans_dropped_by_filter.toLocaleString()}
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="px-3 py-1.5">Spans kept after filter</td>
                  <td className="px-3 py-1.5 font-mono">
                    {previewResult.spans_kept_after_filter.toLocaleString()}
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="px-3 py-1.5">Spans renamed (mapping)</td>
                  <td className="px-3 py-1.5 font-mono">
                    {previewResult.spans_renamed.toLocaleString()}
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="px-3 py-1.5">Projected documents</td>
                  <td className="px-3 py-1.5 font-mono">
                    {previewResult.projected_document_count.toLocaleString()}
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-1.5">Projected spans</td>
                  <td className="px-3 py-1.5 font-mono">
                    {previewResult.projected_span_count.toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
            {previewResult.split_document_counts &&
              Object.keys(previewResult.split_document_counts).length > 0 && (
                <p className="border-t border-gray-100 px-3 py-2 text-gray-600">
                  Splits:{' '}
                  {Object.entries(previewResult.split_document_counts)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(' · ')}
                </p>
              )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handlePreview}
              disabled={!source || previewMutation.isPending}
              className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-40"
            >
              {previewMutation.isPending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Telescope size={15} />
              )}
              Refresh preview
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                !source || !outputName.trim() || mutation.isPending || dropMappingConflict.length > 0
              }
              className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:opacity-40"
            >
              {mutation.isPending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Wand2 size={15} />
              )}
              Transform
            </button>
            {mutation.isError && (
              <span className="text-xs text-red-600">{(mutation.error as Error).message}</span>
            )}
            {previewMutation.isError && (
              <span className="text-xs text-red-600">
                {(previewMutation.error as Error).message}
              </span>
            )}
          </div>
          {mutation.isPending && (
            <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-gray-200">
              <div className="h-full w-full animate-pulse bg-gray-800" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
