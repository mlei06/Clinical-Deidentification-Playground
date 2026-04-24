import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Play, Loader2 } from 'lucide-react';
import PipelineSelector from '../shared/PipelineSelector';
import EvalLabelAlignment from './EvalLabelAlignment';
import { useRunEvaluation } from '../../hooks/useEvalRuns';
import { useDataset, useDatasets } from '../../hooks/useDatasets';
import type { EvalRunDetail, EvalRunRequest } from '../../api/types';

interface EvalRunFormProps {
  onResult: (run: EvalRunDetail) => void;
}

type SourceMode = 'registered' | 'path';
type EvalMode = 'full' | 'sample';

export default function EvalRunForm({ onResult }: EvalRunFormProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [pipeline, setPipeline] = useState('');
  const [sourceMode, setSourceMode] = useState<SourceMode>('registered');
  const [datasetName, setDatasetName] = useState('');
  const [datasetPath, setDatasetPath] = useState('');
  const [splitsText, setSplitsText] = useState('');
  const [evalMode, setEvalMode] = useState<EvalMode>('full');
  const [sampleSizeText, setSampleSizeText] = useState('');
  const [useFixedSeed, setUseFixedSeed] = useState(false);
  const [seedText, setSeedText] = useState('');
  const [saveSample, setSaveSample] = useState(false);
  const [saveSampleName, setSaveSampleName] = useState('');
  const [includePerDoc, setIncludePerDoc] = useState(false);
  const [includePerDocSpans, setIncludePerDocSpans] = useState(false);

  const { data: datasets, isLoading: datasetsLoading } = useDatasets();
  const datasetDetailQuery = useDataset(
    sourceMode === 'registered' && datasetName.trim() ? datasetName.trim() : null,
  );
  const mutation = useRunEvaluation();

  useEffect(() => {
    const pre = searchParams.get('dataset')?.trim();
    const sp = searchParams.get('splits')?.trim();
    if (!pre && !sp) return;
    if (pre) {
      setSourceMode('registered');
      setDatasetName(pre);
    }
    if (sp) setSplitsText(sp);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('dataset');
        next.delete('splits');
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  const datasetSplits = useMemo(
    () =>
      splitsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [splitsText],
  );

  const sampleSize = sampleSizeText.trim() === '' ? NaN : Number(sampleSizeText);
  const sampleSizeValid = Number.isInteger(sampleSize) && sampleSize > 0;
  const parsedSeed = seedText.trim() === '' ? NaN : Number(seedText);
  const seedValid = Number.isInteger(parsedSeed);

  /** Upper bound on sample size derived from registered-dataset metadata, when available. */
  const documentsAfterSplits = useMemo(() => {
    if (sourceMode !== 'registered') return null;
    const detail = datasetDetailQuery.data;
    if (!detail) return null;
    if (datasetSplits.length === 0) return detail.document_count;
    const counts = detail.split_document_counts;
    if (!counts) return null;
    let total = 0;
    for (const s of datasetSplits) {
      total += counts[s] ?? 0;
    }
    return total;
  }, [sourceMode, datasetDetailQuery.data, datasetSplits]);

  const sampleExceedsKnownMax =
    evalMode === 'sample' &&
    sampleSizeValid &&
    documentsAfterSplits != null &&
    sampleSize > documentsAfterSplits;

  // Mirror the server-side name rule (dataset_store._SAFE_NAME) for early feedback.
  const SAFE_DATASET_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
  const saveSampleEnabled = evalMode === 'sample' && saveSample;
  const saveSampleNameTrimmed = saveSampleName.trim();
  const saveSampleNameValid =
    !saveSampleEnabled ||
    (saveSampleNameTrimmed.length > 0 && SAFE_DATASET_NAME.test(saveSampleNameTrimmed));
  const saveSampleNameCollides =
    saveSampleEnabled &&
    saveSampleNameValid &&
    (datasets ?? []).some((d) => d.name === saveSampleNameTrimmed);

  const canRunRegistered = pipeline && datasetName.trim();
  const canRunPath = pipeline && datasetPath.trim();
  const sampleInputsOk =
    evalMode === 'full' ||
    (sampleSizeValid && !sampleExceedsKnownMax && (!useFixedSeed || seedValid));
  const saveInputsOk = !saveSampleEnabled || (saveSampleNameValid && !saveSampleNameCollides);
  const canRun =
    (sourceMode === 'registered' ? canRunRegistered : canRunPath) &&
    sampleInputsOk &&
    saveInputsOk;

  const handleRun = () => {
    if (!canRun || mutation.isPending) return;
    const splitPayload =
      datasetSplits.length > 0 ? { dataset_splits: datasetSplits } : {};
    const samplePayload: Partial<EvalRunRequest> =
      evalMode === 'sample'
        ? {
            eval_mode: 'sample',
            sample_size: sampleSize,
            ...(useFixedSeed && seedValid ? { sample_seed: parsedSeed } : {}),
            ...(saveSampleEnabled
              ? { save_sample_as: { dataset_name: saveSampleNameTrimmed } }
              : {}),
          }
        : {};
    const perDocPayload: Partial<EvalRunRequest> = includePerDocSpans
      ? { include_per_document_spans: true }
      : includePerDoc
        ? { include_per_document: true }
        : {};
    const base: EvalRunRequest =
      sourceMode === 'registered'
        ? { pipeline_name: pipeline, dataset_name: datasetName.trim() }
        : { pipeline_name: pipeline, dataset_path: datasetPath.trim() };
    mutation.mutate(
      { ...base, ...splitPayload, ...samplePayload, ...perDocPayload },
      { onSuccess: onResult },
    );
  };

  const names = (datasets ?? []).map((d) => d.name).sort();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Pipeline</label>
          <PipelineSelector value={pipeline} onChange={setPipeline} />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Gold data</span>
          <div className="flex items-center gap-1 rounded-md border border-gray-200 p-0.5">
            <button
              type="button"
              onClick={() => setSourceMode('registered')}
              className={`rounded px-2 py-1 text-xs font-medium ${
                sourceMode === 'registered'
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Registered
            </button>
            <button
              type="button"
              onClick={() => setSourceMode('path')}
              className={`rounded px-2 py-1 text-xs font-medium ${
                sourceMode === 'path'
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Path on server
            </button>
          </div>
        </div>

        {sourceMode === 'registered' ? (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Dataset</label>
            <select
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
              disabled={datasetsLoading}
              className="min-w-[12rem] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none disabled:opacity-50"
            >
              <option value="">{datasetsLoading ? 'Loading…' : 'Select dataset…'}</option>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Gold JSONL path (on server)</label>
            <input
              type="text"
              value={datasetPath}
              onChange={(e) => setDatasetPath(e.target.value)}
              placeholder="/path/to/corpus.jsonl"
              className="min-w-[16rem] rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            />
            <span className="text-[11px] text-gray-400">
              BRAT gold must be converted to JSONL first (Datasets → Convert BRAT).
            </span>
          </div>
        )}

        <div className="flex min-w-[14rem] max-w-md flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">
            Document splits <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            type="text"
            value={splitsText}
            onChange={(e) => setSplitsText(e.target.value)}
            placeholder="e.g. train, valid — matches metadata.split"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Eval mode</span>
          <div className="flex items-center gap-1 rounded-md border border-gray-200 p-0.5">
            <button
              type="button"
              onClick={() => setEvalMode('full')}
              className={`rounded px-2 py-1 text-xs font-medium ${
                evalMode === 'full'
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Full corpus
            </button>
            <button
              type="button"
              onClick={() => setEvalMode('sample')}
              className={`rounded px-2 py-1 text-xs font-medium ${
                evalMode === 'sample'
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Random sample
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleRun}
          disabled={!canRun || mutation.isPending}
          className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:opacity-40"
        >
          {mutation.isPending ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Play size={15} />
          )}
          Run evaluation
        </button>
        {mutation.isError && (
          <span className="text-xs text-red-600">{(mutation.error as Error).message}</span>
        )}
      </div>

      {evalMode === 'sample' && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-gray-200 bg-gray-50/60 px-3 py-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">
              Sample size
              {documentsAfterSplits != null && (
                <span className="ml-1 font-normal text-gray-400">
                  (max {documentsAfterSplits})
                </span>
              )}
            </label>
            <input
              type="number"
              min={1}
              step={1}
              value={sampleSizeText}
              onChange={(e) => setSampleSizeText(e.target.value)}
              placeholder="e.g. 100"
              className="w-28 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            />
            {sampleExceedsKnownMax && (
              <span className="text-[11px] text-amber-700">
                Exceeds documents after splits ({documentsAfterSplits}).
              </span>
            )}
            {!sampleSizeValid && sampleSizeText.trim() !== '' && (
              <span className="text-[11px] text-amber-700">
                Enter a positive integer.
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
              <input
                type="checkbox"
                checked={useFixedSeed}
                onChange={(e) => setUseFixedSeed(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Fixed seed
            </label>
            {useFixedSeed ? (
              <>
                <input
                  type="number"
                  step={1}
                  value={seedText}
                  onChange={(e) => setSeedText(e.target.value)}
                  placeholder="e.g. 42"
                  className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
                />
                {!seedValid && seedText.trim() !== '' && (
                  <span className="text-[11px] text-amber-700">
                    Seed must be an integer.
                  </span>
                )}
              </>
            ) : (
              <span className="text-[11px] text-gray-500">
                Random each run — server returns <code className="font-mono">sample_seed_used</code>.
              </span>
            )}
          </div>

          {sourceMode === 'path' && (
            <span className="text-[11px] text-gray-500">
              Max is validated server-side against the corpus after splits.
            </span>
          )}

          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
              <input
                type="checkbox"
                checked={saveSample}
                onChange={(e) => setSaveSample(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Save sample as dataset
            </label>
            {saveSample ? (
              <>
                <input
                  type="text"
                  value={saveSampleName}
                  onChange={(e) => setSaveSampleName(e.target.value)}
                  placeholder="new dataset name"
                  className="w-48 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
                />
                {saveSampleNameTrimmed !== '' && !saveSampleNameValid && (
                  <span className="text-[11px] text-amber-700">
                    Letters, digits, <code className="font-mono">. _ -</code>; must start with alnum.
                  </span>
                )}
                {saveSampleNameCollides && (
                  <span className="text-[11px] text-amber-700">Name already in use.</span>
                )}
              </>
            ) : (
              <span className="text-[11px] text-gray-500">
                Registers the sampled docs under <code className="font-mono">data/corpora/</code>.
              </span>
            )}
          </div>
        </div>
      )}
      {sourceMode === 'registered' && !datasetsLoading && names.length === 0 && (
        <p className="text-xs text-amber-700">
          No registered datasets. Register one under Datasets or use &quot;Path on server&quot;.
        </p>
      )}

      <div className="flex flex-wrap items-start gap-4 rounded-md border border-gray-100 bg-white px-3 py-2 text-xs">
        <span className="font-medium text-gray-500">Per-document inspection</span>
        <label className="flex items-center gap-1.5 text-gray-700">
          <input
            type="checkbox"
            checked={includePerDoc || includePerDocSpans}
            onChange={(e) => {
              setIncludePerDoc(e.target.checked);
              if (!e.target.checked) setIncludePerDocSpans(false);
            }}
            className="h-3.5 w-3.5"
          />
          Include per-doc scores
        </label>
        <label className="flex items-center gap-1.5 text-gray-700">
          <input
            type="checkbox"
            checked={includePerDocSpans}
            onChange={(e) => {
              setIncludePerDocSpans(e.target.checked);
              if (e.target.checked) setIncludePerDoc(true);
            }}
            className="h-3.5 w-3.5"
          />
          Include gold vs pred spans
        </label>
        {includePerDocSpans && (
          <span className="text-[11px] text-amber-700">
            Response will carry raw document text — admin session only.
          </span>
        )}
        <span className="text-[11px] text-gray-500">
          Available only for the run you just triggered; reloading from history does not
          re-fetch per-doc data.
        </span>
      </div>

      <EvalLabelAlignment
        sourceMode={sourceMode}
        datasetName={datasetName}
        datasetPath={datasetPath}
        pipelineName={pipeline}
      />
    </div>
  );
}
