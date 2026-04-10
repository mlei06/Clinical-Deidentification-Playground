import { useState } from 'react';
import { Play, Loader2 } from 'lucide-react';
import PipelineSelector from '../shared/PipelineSelector';
import { useRunEvaluation } from '../../hooks/useEvalRuns';
import type { EvalRunDetail } from '../../api/types';

interface EvalRunFormProps {
  onResult: (run: EvalRunDetail) => void;
}

export default function EvalRunForm({ onResult }: EvalRunFormProps) {
  const [pipeline, setPipeline] = useState('');
  const [datasetPath, setDatasetPath] = useState('');
  const [format, setFormat] = useState<'jsonl' | 'brat-dir' | 'brat-corpus'>('jsonl');

  const mutation = useRunEvaluation();

  const handleRun = () => {
    if (!pipeline || !datasetPath.trim()) return;
    mutation.mutate(
      { pipeline_name: pipeline, dataset_path: datasetPath, dataset_format: format },
      { onSuccess: onResult },
    );
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500">Pipeline</label>
        <PipelineSelector value={pipeline} onChange={setPipeline} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500">Dataset Path</label>
        <input
          type="text"
          value={datasetPath}
          onChange={(e) => setDatasetPath(e.target.value)}
          placeholder="/path/to/corpus.jsonl"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500">Format</label>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as typeof format)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
        >
          <option value="jsonl">JSONL</option>
          <option value="brat-dir">BRAT Directory</option>
          <option value="brat-corpus">BRAT Corpus</option>
        </select>
      </div>
      <button
        onClick={handleRun}
        disabled={!pipeline || !datasetPath.trim() || mutation.isPending}
        className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:opacity-40"
      >
        {mutation.isPending ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <Play size={15} />
        )}
        Run Evaluation
      </button>
      {mutation.isError && (
        <span className="text-xs text-red-600">{(mutation.error as Error).message}</span>
      )}
    </div>
  );
}
