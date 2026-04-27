import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Loader2, Square, AlertCircle, CheckCircle2, Keyboard } from 'lucide-react';
import DatasetSwitcher from './DatasetSwitcher';
import DatasetFileList from './DatasetFileList';
import DocumentReviewer from './DocumentReviewer';
import { useModes } from '../../hooks/useModes';
import {
  useProductionStore,
  useActiveDataset,
  useHasHydrated,
  DEFAULT_EXPORT_TYPE,
  type ExportOutputType,
} from './store';
import { useBatchDetect } from './useBatchDetect';
import { useFileListKeybinds } from './useFileListKeybinds';

const EXPORT_TYPES: { value: ExportOutputType; label: string }[] = [
  { value: 'redacted', label: 'redacted' },
  { value: 'annotated', label: 'annotated' },
  { value: 'surrogate_annotated', label: 'surrogate_annotated' },
];

export default function ProductionView() {
  const hydrated = useHasHydrated();
  const reviewer = useProductionStore((s) => s.reviewer);
  const setReviewer = useProductionStore((s) => s.setReviewer);
  const createDataset = useProductionStore((s) => s.createDataset);
  const setDatasetExportType = useProductionStore((s) => s.setDatasetExportType);
  const setDatasetDefaultMode = useProductionStore((s) => s.setDatasetDefaultMode);
  const active = useActiveDataset();

  const { data: modesData } = useModes();
  const { run, cancel, running, progress } = useBatchDetect();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [runTarget, setRunTarget] = useState<string>('');
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const visibleFiles = active?.files ?? [];

  useFileListKeybinds({
    dataset: active,
    visible: visibleFiles,
    rootRef,
    enabled: !running,
    onOpenCheatSheet: () => setShowShortcuts(true),
  });

  // Bootstrap only after persist rehydrates — otherwise we overwrite real IDB data.
  useEffect(() => {
    if (!hydrated) return;
    const state = useProductionStore.getState();
    if (Object.keys(state.datasets).length === 0) {
      createDataset('Dataset 1');
    }
  }, [createDataset, hydrated]);

  // Reset selection when switching dataset.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [active?.id]);

  // Keep `runTarget` synced with the dataset default or the API's default mode.
  useEffect(() => {
    if (!active) return;
    if (active.defaultDetectionMode) {
      setRunTarget(active.defaultDetectionMode);
      return;
    }
    if (modesData?.default_mode) {
      const def = modesData.modes.find((m) => m.name === modesData.default_mode);
      if (def?.available) setRunTarget(modesData.default_mode);
    }
  }, [active?.id, active?.defaultDetectionMode, modesData]);

  const modes = modesData?.modes ?? [];
  const selectedMode = useMemo(
    () => modes.find((m) => m.name === runTarget) ?? null,
    [modes, runTarget],
  );
  const targetResolvable = Boolean(runTarget) && (!selectedMode || selectedMode.available);

  const currentFile = useMemo(() => {
    if (!active) return null;
    return active.files.find((f) => f.id === active.currentFileId) ?? null;
  }, [active]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = (visibleIds: string[]) => {
    setSelectedIds((prev) => {
      if (visibleIds.length === 0) return prev;
      const allVisibleSelected = visibleIds.every((id) => prev.has(id));
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  };

  const handleRun = async () => {
    if (!active || !runTarget) return;
    let ids = Array.from(selectedIds);
    if (ids.length === 0 && currentFile) ids = [currentFile.id];
    if (ids.length === 0) return;

    const resolvedInSelection = active.files.filter(
      (f) => ids.includes(f.id) && f.resolved,
    );
    if (resolvedInSelection.length > 0) {
      const ok = confirm(
        `${resolvedInSelection.length} resolved file(s) are in the selection. ` +
          'Re-running detection will REPLACE annotations and clear the resolved flag. Continue?',
      );
      if (!ok) return;
    }

    if (saveAsDefault && runTarget !== active.defaultDetectionMode) {
      setDatasetDefaultMode(active.id, runTarget);
    }

    await run({
      datasetId: active.id,
      fileIds: ids,
      target: runTarget,
      reviewer: reviewer || 'production-ui',
      clearResolved: true,
    });
  };

  if (!active) {
    return (
      <div className="flex h-full flex-col bg-gray-50">
        <header className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-2">
          <DatasetSwitcher />
          <p className="text-xs text-gray-500">
            No dataset selected. Create one above or pick an existing dataset.
          </p>
        </header>
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-gray-500">
          Add a dataset from the switcher to use the workbench.
        </div>
      </div>
    );
  }

  const selectionCount = selectedIds.size;
  const runButtonLabel =
    selectionCount === 0
      ? currentFile
        ? 'Run on current file'
        : 'Run detection'
      : `Run on ${selectionCount} selected`;

  return (
    <div
      ref={rootRef}
      className="flex h-full flex-col bg-gray-50"
      tabIndex={-1}
    >
      <header className="flex flex-wrap items-end gap-3 border-b border-gray-200 bg-white px-4 py-2">
        <DatasetSwitcher />

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Run with</label>
          <div className="flex items-center gap-2">
            <select
              value={runTarget}
              onChange={(e) => setRunTarget(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm"
            >
              <option value="">Select mode…</option>
              {modes.map((m) => (
                <option key={m.name} value={m.name} disabled={!m.available}>
                  {m.name}
                  {!m.available ? ' (unavailable)' : ''}
                </option>
              ))}
            </select>
            {selectedMode && selectedMode.available && (
              <span
                className="inline-flex items-center gap-1 text-[11px] text-gray-500"
                title={selectedMode.description}
              >
                <CheckCircle2 size={11} className="text-green-600" />
                <code className="text-gray-700">{selectedMode.pipeline}</code>
              </span>
            )}
            {selectedMode && !selectedMode.available && (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                <AlertCircle size={11} />
                missing: {selectedMode.missing.join(', ')}
              </span>
            )}
          </div>
          <label className="flex items-center gap-1 text-[10px] text-gray-500">
            <input
              type="checkbox"
              checked={saveAsDefault}
              onChange={(e) => setSaveAsDefault(e.target.checked)}
            />
            Set as dataset default
          </label>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Export as</label>
          <select
            value={active.exportOutputType ?? DEFAULT_EXPORT_TYPE}
            onChange={(e) =>
              setDatasetExportType(active.id, e.target.value as ExportOutputType)
            }
            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm"
            title="Sets the output_type for every line in this dataset's JSONL export"
          >
            {EXPORT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Reviewer</label>
          <input
            type="text"
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
            placeholder="Your name or ID"
            className="w-40 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm focus:border-blue-400 focus:outline-none"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowShortcuts(true)}
            className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            title="Show keyboard shortcuts (?)"
          >
            <Keyboard size={12} />
            Shortcuts
          </button>
          {running && (
            <span className="text-[11px] text-blue-600">
              detecting {progress.done}/{progress.total}…
            </span>
          )}
          <button
            type="button"
            onClick={handleRun}
            disabled={!targetResolvable || running || (selectionCount === 0 && !currentFile)}
            className="flex items-center gap-1 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-40"
            title={
              !runTarget
                ? 'Pick a mode first'
                : selectedMode && !selectedMode.available
                  ? `Mode unavailable — missing: ${selectedMode.missing.join(', ')}`
                  : runButtonLabel
            }
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {runButtonLabel}
          </button>
          {running && (
            <button
              type="button"
              onClick={cancel}
              className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Square size={10} />
              Cancel
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <DatasetFileList
          dataset={active}
          selectedIds={selectedIds}
          onToggleSelected={toggleSelected}
          onToggleSelectAllVisible={toggleSelectAllVisible}
          disabled={running}
        />
        <div className="flex min-h-0 flex-1 flex-col">
          {currentFile ? (
            currentFile.detectionStatus === 'pending' ? (
              <EmptyPane message="Select this file in the list and click Run detection." />
            ) : currentFile.detectionStatus === 'processing' ? (
              <EmptyPane message="Detecting spans…" spinning />
            ) : currentFile.detectionStatus === 'error' ? (
              <EmptyPane
                message={`Detection failed: ${currentFile.error ?? 'unknown error'}`}
                tone="error"
              />
            ) : (
              <DocumentReviewer
                datasetId={active.id}
                dataset={active}
                file={currentFile}
                reviewer={reviewer}
              />
            )
          ) : (
            <EmptyPane message="No file selected. Add files or pick one from the list." />
          )}
        </div>
      </div>
      {showShortcuts && (
        <ShortcutCheatSheet onClose={() => setShowShortcuts(false)} />
      )}
    </div>
  );
}

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: '↑ / ↓', description: 'Previous / next file in the list' },
  { keys: 'J / K', description: 'Next / previous unresolved file' },
  { keys: 'N', description: 'Next file whose detection failed' },
  { keys: 'R', description: 'Toggle resolved on the current file' },
  { keys: '?', description: 'Show this cheat sheet' },
];

function ShortcutCheatSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Close
          </button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys}>
                <td className="py-1 pr-4 font-mono text-xs text-gray-700">{s.keys}</td>
                <td className="py-1 text-gray-600">{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] text-gray-400">
          Shortcuts only fire while the workbench has focus and the active element
          is not an input, textarea, or editable field.
        </p>
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
