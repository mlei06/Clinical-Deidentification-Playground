import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Play, Loader2 } from 'lucide-react';
import PipelineSelector from '../shared/PipelineSelector';
import { useRunEvaluation } from '../../hooks/useEvalRuns';
import { useDatasets } from '../../hooks/useDatasets';
import type { EvalRunDetail } from '../../api/types';

interface EvalRunFormProps {
  onResult: (run: EvalRunDetail) => void;
}

type SourceMode = 'registered' | 'path';

export default function EvalRunForm({ onResult }: EvalRunFormProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [pipeline, setPipeline] = useState('');
  const [sourceMode, setSourceMode] = useState<SourceMode>('registered');
  const [datasetName, setDatasetName] = useState('');
  const [datasetPath, setDatasetPath] = useState('');
  const [splitsText, setSplitsText] = useState('');

  const { data: datasets, isLoading: datasetsLoading } = useDatasets();
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

  const canRunRegistered = pipeline && datasetName.trim();
  const canRunPath = pipeline && datasetPath.trim();
  const canRun = sourceMode === 'registered' ? canRunRegistered : canRunPath;

  const handleRun = () => {
    if (!canRun || mutation.isPending) return;
    const splitPayload =
      datasetSplits.length > 0 ? { dataset_splits: datasetSplits } : {};
    if (sourceMode === 'registered') {
      mutation.mutate(
        { pipeline_name: pipeline, dataset_name: datasetName.trim(), ...splitPayload },
        { onSuccess: onResult },
      );
    } else {
      mutation.mutate(
        {
          pipeline_name: pipeline,
          dataset_path: datasetPath.trim(),
          ...splitPayload,
        },
        { onSuccess: onResult },
      );
    }
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
      {sourceMode === 'registered' && !datasetsLoading && names.length === 0 && (
        <p className="text-xs text-amber-700">
          No registered datasets. Register one under Datasets or use &quot;Path on server&quot;.
        </p>
      )}
    </div>
  );
}
