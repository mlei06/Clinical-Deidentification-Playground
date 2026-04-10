import { useState } from 'react';
import { Play, Loader2 } from 'lucide-react';
import PipelineSelector from '../shared/PipelineSelector';
import TextInput from './TextInput';
import AnnotatedDocumentViewer from '../shared/AnnotatedDocumentViewer';
import TraceTimeline from './TraceTimeline';
import { useProcessText } from '../../hooks/useProcess';
import type { ProcessResponse } from '../../api/types';

export default function InferenceView() {
  const [pipeline, setPipeline] = useState('');
  const [text, setText] = useState('');
  const [result, setResult] = useState<ProcessResponse | null>(null);

  const mutation = useProcessText();

  const handleRun = () => {
    if (!pipeline || !text.trim()) return;
    mutation.mutate(
      { pipelineName: pipeline, req: { text }, trace: true },
      { onSuccess: setResult },
    );
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6">
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Pipeline</label>
          <PipelineSelector value={pipeline} onChange={setPipeline} />
        </div>
        <button
          onClick={handleRun}
          disabled={!pipeline || !text.trim() || mutation.isPending}
          className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {mutation.isPending ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Play size={15} />
          )}
          Run
        </button>
      </div>

      <TextInput value={text} onChange={setText} />

      {mutation.isError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(mutation.error as Error).message}
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-4">
          <AnnotatedDocumentViewer
            originalText={result.original_text}
            redactedText={result.redacted_text}
            spans={result.spans}
            processingTimeMs={result.processing_time_ms}
            pipelineName={result.pipeline_name}
          />

          {result.intermediary_trace && result.intermediary_trace.length > 0 && (
            <TraceTimeline frames={result.intermediary_trace} />
          )}
        </div>
      )}
    </div>
  );
}
