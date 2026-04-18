import { useMemo, useEffect } from 'react';
import { Play, Loader2, Square } from 'lucide-react';
import ModeSelector from './ModeSelector';
import DocumentQueue from './DocumentQueue';
import DocumentReviewer from './DocumentReviewer';
import BatchExport from './BatchExport';
import { useModes } from '../../hooks/useModes';
import { useReviewQueue } from './store';
import { useBatchDetect } from './useBatchDetect';

export default function ProductionView() {
  const { reviewer, mode, docs, currentId, setReviewer, setMode } = useReviewQueue();
  const { data: modesData } = useModes();

  // Auto-select default mode on first load, but only if it's available.
  useEffect(() => {
    if (mode || !modesData?.default_mode) return;
    const def = modesData.modes.find((m) => m.name === modesData.default_mode);
    if (def?.available) setMode(modesData.default_mode);
  }, [modesData, mode, setMode]);

  const selectedMode = useMemo(() => {
    if (!mode || !modesData) return null;
    return modesData.modes.find((m) => m.name === mode) ?? null;
  }, [mode, modesData]);

  const pipelineName = selectedMode?.available ? selectedMode.pipeline : null;

  const { run, running } = useBatchDetect(pipelineName, reviewer);

  const currentDoc = docs.find((d) => d.id === currentId) ?? null;
  const pendingCount = docs.filter((d) => d.status === 'pending').length;

  return (
    <div className="flex h-full flex-col bg-gray-50">
      <header className="flex flex-wrap items-end gap-3 border-b border-gray-200 bg-white px-4 py-2">
        <ModeSelector value={mode} onChange={setMode} />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Reviewer</label>
          <input
            type="text"
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
            placeholder="Your name or ID"
            className="w-48 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-400 focus:outline-none"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-gray-400">
            {pendingCount > 0 ? `${pendingCount} docs pending detection` : 'All detected'}
          </span>
          <button
            type="button"
            onClick={run}
            disabled={!pipelineName || !reviewer.trim() || pendingCount === 0 || running}
            className="flex items-center gap-1 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-40"
            title={
              selectedMode && !selectedMode.available
                ? `Mode unavailable — missing: ${selectedMode.missing.join(', ')}`
                : !pipelineName
                  ? 'Pick an available mode'
                  : !reviewer.trim()
                    ? 'Enter a reviewer name'
                    : 'Detect spans for all pending docs'
            }
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Detect pending
          </button>
          {running && (
            <span className="flex items-center gap-1 text-[11px] text-blue-600">
              <Square size={10} />
              running...
            </span>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <DocumentQueue disabled={running} />
        <div className="flex min-h-0 flex-1 flex-col">
          {currentDoc ? (
            currentDoc.status === 'pending' ? (
              <EmptyPane message="Click 'Detect pending' to run the mode pipeline on this document." />
            ) : currentDoc.status === 'processing' ? (
              <EmptyPane message="Detecting spans..." spinning />
            ) : currentDoc.status === 'error' ? (
              <EmptyPane
                message={`Detection failed: ${currentDoc.error ?? 'unknown error'}`}
                tone="error"
              />
            ) : (
              <DocumentReviewer doc={currentDoc} reviewer={reviewer} />
            )
          ) : (
            <EmptyPane message="No document selected. Upload files and pick one from the queue." />
          )}
          <BatchExport docs={docs} mode={mode} reviewer={reviewer} />
        </div>
      </div>
    </div>
  );
}

function EmptyPane({
  message,
  tone,
  spinning,
}: {
  message: string;
  tone?: 'error';
  spinning?: boolean;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div
        className={`flex items-center gap-2 rounded-md px-4 py-3 text-sm ${
          tone === 'error'
            ? 'border border-red-200 bg-red-50 text-red-700'
            : 'text-gray-500'
        }`}
      >
        {spinning && <Loader2 size={14} className="animate-spin" />}
        {message}
      </div>
    </div>
  );
}
