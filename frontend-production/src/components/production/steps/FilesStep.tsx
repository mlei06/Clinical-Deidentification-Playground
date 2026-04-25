import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Keyboard, ArrowRight } from 'lucide-react';
import DatasetFileList from '../DatasetFileList';
import ShortcutCheatSheet from '../ShortcutCheatSheet';
import { useFileListKeybinds } from '../useFileListKeybinds';
import {
  useActiveDataset,
  useProductionStore,
} from '../store';
import { useModes } from '../../../hooks/useModes';

export default function FilesStep() {
  const active = useActiveDataset();
  const setDatasetDefaultMode = useProductionStore((s) => s.setDatasetDefaultMode);
  const { data: modesData } = useModes();
  const navigate = useNavigate();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showShortcuts, setShowShortcuts] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useFileListKeybinds({
    dataset: active,
    visible: active?.files ?? [],
    rootRef,
    enabled: true,
    onOpenCheatSheet: () => setShowShortcuts(true),
  });

  const modes = modesData?.modes ?? [];
  const counts = useMemo(() => {
    if (!active) return { total: 0, resolved: 0, errored: 0, ready: 0 };
    let resolved = 0;
    let errored = 0;
    let ready = 0;
    for (const f of active.files) {
      if (f.resolved) resolved += 1;
      if (f.detectionStatus === 'error') errored += 1;
      if (f.detectionStatus === 'ready') ready += 1;
    }
    return { total: active.files.length, resolved, errored, ready };
  }, [active]);

  if (!active) return null;

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
      const allSel = visibleIds.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of visibleIds) {
        if (allSel) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  return (
    <div ref={rootRef} className="flex h-full flex-col bg-gray-50" tabIndex={-1}>
      <header className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex flex-col">
          <h1 className="text-sm font-semibold text-gray-900">Files</h1>
          <span className="text-[11px] text-gray-500">
            {counts.total} total · {counts.ready} detected · {counts.resolved} resolved
            {counts.errored > 0 && ` · ${counts.errored} errored`}
          </span>
        </div>
        <label className="flex flex-col gap-0.5 text-[11px] font-medium text-gray-500">
          Default detection mode
          <select
            value={active.defaultDetectionMode}
            onChange={(e) => setDatasetDefaultMode(active.id, e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800"
          >
            <option value="">No default</option>
            {modes.map((m) => (
              <option key={m.name} value={m.name} disabled={!m.available}>
                {m.name}
                {!m.available ? ' (unavailable)' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowShortcuts(true)}
            className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            <Keyboard size={12} />
            Shortcuts
          </button>
          <button
            type="button"
            onClick={() => navigate(`/datasets/${active.id}/detect`)}
            disabled={counts.total === 0}
            className="inline-flex items-center gap-1 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-40"
          >
            Continue to Detect
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
        />
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-gray-500">
          {counts.total === 0
            ? 'Upload .txt or .jsonl files, or paste text, to start.'
            : 'Use the file list on the left to add or remove files. Continue to Detect when ready.'}
        </div>
      </div>

      {showShortcuts && <ShortcutCheatSheet onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
