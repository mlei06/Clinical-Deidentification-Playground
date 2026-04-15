import { useState, useMemo } from 'react';
import {
  Play,
  Loader2,
  Save,
  FolderOpen,
  Download,
  FileJson,
  FileText,
  Trash2,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PipelineSelector from '../shared/PipelineSelector';
import TextInput from './TextInput';
import AnnotatedDocumentViewer from '../shared/AnnotatedDocumentViewer';
import TraceTimeline from './TraceTimeline';
import { useProcessText } from '../../hooks/useProcess';
import {
  listInferenceRuns,
  saveInferenceSnapshot,
  getInferenceRun,
  deleteInferenceRun,
} from '../../api/inference';
import { downloadBlob } from '../../lib/download';
import type { OutputMode, ProcessResponse, SavedInferenceRunDetail } from '../../api/types';

function toProcessResponse(d: SavedInferenceRunDetail): ProcessResponse {
  const { id: _id, saved_at: _saved, ...rest } = d;
  return rest;
}

function exportFilenameBase(pipelineName: string): string {
  const safe = pipelineName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64) || 'inference';
  const day = new Date().toISOString().slice(0, 10);
  return `${safe}_${day}`;
}

export default function InferenceView() {
  const [pipeline, setPipeline] = useState('');
  const [text, setText] = useState('');
  const [outputMode, setOutputMode] = useState<OutputMode>('redacted');
  const [result, setResult] = useState<ProcessResponse | null>(null);
  /** Set when the current view came from a saved snapshot (or right after saving). */
  const [snapshotMeta, setSnapshotMeta] = useState<{ id: string; saved_at: string } | null>(null);
  const [selectedRunId, setSelectedRunId] = useState('');

  const queryClient = useQueryClient();
  const mutation = useProcessText();

  const { data: savedRuns = [], isLoading: runsLoading } = useQuery({
    queryKey: ['inference-runs'],
    queryFn: listInferenceRuns,
  });

  const saveMutation = useMutation({
    mutationFn: saveInferenceSnapshot,
    onSuccess: (detail) => {
      queryClient.invalidateQueries({ queryKey: ['inference-runs'] });
      setResult(toProcessResponse(detail));
      setSnapshotMeta({ id: detail.id, saved_at: detail.saved_at });
      setPipeline(detail.pipeline_name);
      setText(detail.original_text);
    },
  });

  const loadMutation = useMutation({
    mutationFn: getInferenceRun,
    onSuccess: (detail) => {
      setResult(toProcessResponse(detail));
      setSnapshotMeta({ id: detail.id, saved_at: detail.saved_at });
      setPipeline(detail.pipeline_name);
      setText(detail.original_text);
      setSelectedRunId(detail.id);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteInferenceRun,
    onSuccess: (_, runId) => {
      queryClient.invalidateQueries({ queryKey: ['inference-runs'] });
      if (snapshotMeta?.id === runId) {
        setSnapshotMeta(null);
        setResult(null);
      }
      if (selectedRunId === runId) {
        setSelectedRunId('');
      }
    },
  });

  const handleRun = () => {
    if (!pipeline || !text.trim()) return;
    setSnapshotMeta(null);
    setSelectedRunId('');
    mutation.mutate(
      { pipelineName: pipeline, req: { text }, trace: true, outputMode },
      { onSuccess: setResult },
    );
  };

  const canSave = result && !saveMutation.isPending;
  const exportPayload = useMemo(() => {
    if (!result) return null;
    if (snapshotMeta) {
      return { ...result, id: snapshotMeta.id, saved_at: snapshotMeta.saved_at };
    }
    return result;
  }, [result, snapshotMeta]);

  const handleDownloadJson = () => {
    if (!exportPayload || !result) return;
    const base = exportFilenameBase(result.pipeline_name);
    downloadBlob(
      `${base}_snapshot.json`,
      JSON.stringify(exportPayload, null, 2),
      'application/json',
    );
  };

  const handleDownloadRedacted = () => {
    if (!result) return;
    const base = exportFilenameBase(result.pipeline_name);
    downloadBlob(`${base}_redacted.txt`, result.redacted_text, 'text/plain; charset=utf-8');
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Pipeline</label>
          <PipelineSelector value={pipeline} onChange={setPipeline} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Output</label>
          <select
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-400 focus:outline-none"
            value={outputMode}
            onChange={(e) => setOutputMode(e.target.value as OutputMode)}
          >
            <option value="annotated">Annotated (no redaction)</option>
            <option value="redacted">Redacted ([LABEL] tags)</option>
            <option value="surrogate">Surrogate (fake data)</option>
          </select>
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

      {/* Load saved snapshots without running inference first */}
      <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-gray-600">Saved snapshots</span>
          {runsLoading && (
            <Loader2 size={12} className="animate-spin text-gray-400" />
          )}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <FolderOpen size={12} className="text-gray-400" />
            <select
              className="min-w-0 max-w-[min(100%,280px)] flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-gray-800"
              value={selectedRunId}
              disabled={runsLoading || loadMutation.isPending || savedRuns.length === 0}
              onChange={(e) => setSelectedRunId(e.target.value)}
            >
              <option value="">
                {savedRuns.length === 0 ? 'No saved snapshots yet' : 'Select a snapshot…'}
              </option>
              {savedRuns.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.pipeline_name} · {r.saved_at.slice(0, 16)} · {r.span_count} spans
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selectedRunId || loadMutation.isPending}
              onClick={() => selectedRunId && loadMutation.mutate(selectedRunId)}
              className="rounded border border-gray-200 bg-white px-2 py-1 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              {loadMutation.isPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                'Load'
              )}
            </button>
            {selectedRunId && (
              <button
                type="button"
                title="Delete selected snapshot"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (selectedRunId && confirm('Delete this saved snapshot?')) {
                    deleteMutation.mutate(selectedRunId);
                  }
                }}
                className="rounded border border-red-100 p-1 text-red-600 hover:bg-red-50 disabled:opacity-40"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>
        {loadMutation.isError && (
          <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-red-700">
            {(loadMutation.error as Error).message}
          </div>
        )}
      </div>

      {mutation.isError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(mutation.error as Error).message}
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs">
            <span className="font-medium text-gray-600">Current result</span>
            {snapshotMeta && (
              <span className="text-gray-400">
                Snapshot <code className="text-[11px] text-gray-600">{snapshotMeta.id}</code>
              </span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={!canSave}
                onClick={() => result && saveMutation.mutate(result)}
                className="flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                {saveMutation.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Save size={12} />
                )}
                Save snapshot
              </button>

              <div className="flex items-center gap-1 border-l border-gray-200 pl-2">
                <Download size={12} className="text-gray-400" />
                <button
                  type="button"
                  onClick={handleDownloadJson}
                  className="flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 font-medium text-gray-700 hover:bg-gray-50"
                >
                  <FileJson size={12} />
                  JSON
                </button>
                <button
                  type="button"
                  onClick={handleDownloadRedacted}
                  className="flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 font-medium text-gray-700 hover:bg-gray-50"
                >
                  <FileText size={12} />
                  Redacted text
                </button>
              </div>
            </div>
          </div>

          {saveMutation.isError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {(saveMutation.error as Error).message}
            </div>
          )}

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
