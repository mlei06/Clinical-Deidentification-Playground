import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Keyboard,
  Loader2,
  Play,
  Square,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DatasetFileList from '../DatasetFileList';
import ShortcutCheatSheet from '../ShortcutCheatSheet';
import { useFileListKeybinds } from '../useFileListKeybinds';
import { useWorkspaceController } from '../useWorkspaceController';
import {
  RESOLVE_STRATEGY_LABEL,
  type ResolveStrategyId,
} from '../../../lib/spanOverlapConflicts';

const RESOLVE_STRATEGIES: ResolveStrategyId[] = [
  'label_priority',
  'longest_wins',
  'leftmost_first',
];

export default function DetectStep() {
  const {
    active,
    modes,
    runTarget,
    setRunTarget,
    saveAsDefault,
    setSaveAsDefault,
    selectedMode,
    targetResolvable,
    currentFile,
    selectedIds,
    selectionCount,
    runButtonLabel,
    running,
    progress,
    toggleSelected,
    toggleSelectAllVisible,
    handleRun,
    cancel,
    autoResolveEnabled,
    autoResolveStrategy,
    setAutoResolveEnabled,
    setAutoResolveStrategy,
  } = useWorkspaceController();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useFileListKeybinds({
    dataset: active,
    visible: active?.files ?? [],
    rootRef,
    enabled: !running,
    onOpenCheatSheet: () => setShowShortcuts(true),
  });

  useEffect(() => {
    if (!active) return;
  }, [active?.id]);

  if (!active) return null;

  const detectableCount = active.files.filter(
    (f) => f.detectionStatus === 'pending' || f.detectionStatus === 'error',
  ).length;

  return (
    <div ref={rootRef} className="flex h-full flex-col bg-gray-50" tabIndex={-1}>
      <header className="flex flex-wrap items-end gap-3 border-b border-gray-200 bg-white px-4 py-2">
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
          <div className="flex flex-wrap items-center gap-1 text-[10px] text-gray-500">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={autoResolveEnabled}
                onChange={(e) => setAutoResolveEnabled(e.target.checked)}
              />
              Auto-resolve overlapping spans
            </label>
            <select
              value={autoResolveStrategy}
              onChange={(e) =>
                setAutoResolveStrategy(e.target.value as ResolveStrategyId)
              }
              disabled={!autoResolveEnabled}
              className="rounded border border-gray-200 bg-white px-1 py-0.5 text-[10px] text-gray-700 disabled:opacity-50"
              title="Strategy applied to detected spans before they replace existing annotations"
            >
              {RESOLVE_STRATEGIES.map((s) => (
                <option key={s} value={s}>
                  {RESOLVE_STRATEGY_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-gray-500">
            {detectableCount} pending · {selectionCount} selected
          </span>
          <button
            type="button"
            onClick={() => setShowShortcuts(true)}
            className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
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
            onClick={() => void handleRun()}
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
          <button
            type="button"
            onClick={() => navigate(`/datasets/${active.id}/review`)}
            disabled={active.files.length === 0}
            className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            Continue to Review
            <ArrowRight size={12} />
          </button>
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
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-gray-500">
          <div className="max-w-md text-center">
            <p>
              Pick a mode and run detection on the selected files. Detection results replace
              existing spans.
            </p>
            <p className="mt-2 text-[11px] text-gray-400">
              Errors will surface in the file list with a red icon — press <kbd>N</kbd> to jump to
              the next failed file.
            </p>
          </div>
        </div>
      </div>

      {showShortcuts && <ShortcutCheatSheet onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
