import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  CheckCircle2,
  Flag,
  Plus,
  RotateCcw,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import SpanHighlighter, { type SpanHighlighterHandle } from '../shared/SpanHighlighter';
import RedactedView from '../shared/RedactedView';
import LabelBadge from '../shared/LabelBadge';
import SpanEditor from '../shared/SpanEditor';
import SaveOutputButton from '../shared/SaveOutputButton';
import ReviewerDualPane from '../shared/ReviewerDualPane';
import ColorKeyPopover from '../shared/ColorKeyPopover';
import {
  useProductionStore,
  type DatasetFile,
  type SavedOutputMode,
} from './store';
import {
  buildSavedOutput,
  isSavedOutputStale,
  previewBytes,
} from './savedOutput';
import { CANONICAL_LABELS } from '../../lib/canonicalLabels';
import { entitySpanKey } from '../../lib/entitySpanKey';
import {
  findConflictSets,
  mergeLabelPrioritySpans,
  resolveConflictDropAll,
  resolveConflictKeepSpan,
  dedupeSpansKeepPrimary,
} from '../../lib/spanOverlapConflicts';
import type { EntitySpanResponse } from '../../api/types';

interface DocumentReviewerProps {
  datasetId: string;
  file: DatasetFile;
  reviewer: string;
  hideEditorPanel?: boolean;
}

interface GhostSelection {
  start: number;
  end: number;
  text: string;
}

function formatSavedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

const MODE_LABELS: Record<SavedOutputMode, string> = {
  annotated: 'annotated',
  redacted: 'redacted',
  surrogate_annotated: 'surrogate',
};

export default function DocumentReviewer({
  datasetId,
  file,
  reviewer,
  hideEditorPanel = false,
}: DocumentReviewerProps) {
  const updateFile = useProductionStore((s) => s.updateFile);
  const setFileResolved = useProductionStore((s) => s.setFileResolved);
  const saveFileOutput = useProductionStore((s) => s.saveFileOutput);

  const [saveMode, setSaveMode] = useState<SavedOutputMode>(
    file.savedOutput?.mode ?? 'annotated',
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [note, setNote] = useState(file.note ?? '');
  const [activeSpanKey, setActiveSpanKey] = useState<string | null>(null);
  const [flashSpanKey, setFlashSpanKey] = useState<string | null>(null);
  const [ghostSelection, setGhostSelection] = useState<GhostSelection | null>(null);
  const [pulseRange, setPulseRange] = useState<{ start: number; end: number } | null>(null);
  const [addLabel, setAddLabel] = useState<string>('OTHER');
  const [outputCollapsed, setOutputCollapsed] = useState(false);
  const [spanPopover, setSpanPopover] = useState<{
    key: string;
    span: EntitySpanResponse;
    left: number;
    top: number;
  } | null>(null);
  const [spanLabelDraft, setSpanLabelDraft] = useState('');
  const rootRef = useRef<HTMLElement | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const highlighterRef = useRef<SpanHighlighterHandle>(null);

  useEffect(() => {
    setNote(file.note ?? '');
    setSaveError(null);
    setActiveSpanKey(null);
    setFlashSpanKey(null);
    setGhostSelection(null);
    setPulseRange(null);
    setOutputCollapsed(false);
    setSpanPopover(null);
    setSpanLabelDraft('');
    setSaveMode(file.savedOutput?.mode ?? 'annotated');
  }, [file.id, file.savedOutput?.mode]);

  useEffect(() => {
    if (!spanPopover) return;
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      setSpanPopover(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [spanPopover]);

  useEffect(() => {
    if (!flashSpanKey) return;
    const t = setTimeout(() => setFlashSpanKey(null), 1200);
    return () => clearTimeout(t);
  }, [flashSpanKey]);

  useEffect(() => {
    if (!pulseRange) return;
    const t = setTimeout(() => setPulseRange(null), 1200);
    return () => clearTimeout(t);
  }, [pulseRange]);

  const uniqueLabels = useMemo(
    () => [...new Set(file.annotations.map((s) => s.label))].sort(),
    [file.annotations],
  );

  const annotationsDiffer = useMemo(() => {
    const detected = file.detectedAt ?? [];
    if (file.annotations.length !== detected.length) return true;
    return file.annotations.some((s, i) => {
      const o = detected[i];
      return !o || s.start !== o.start || s.end !== o.end || s.label !== o.label;
    });
  }, [file.annotations, file.detectedAt]);

  const conflictSets = useMemo(
    () => findConflictSets(file.annotations, file.originalText),
    [file.annotations, file.originalText],
  );

  const overlapConflictRangeKeys = useMemo(
    () => new Set(conflictSets.map((c) => `${c.start}-${c.end}`)),
    [conflictSets],
  );

  const overlapSpanCandidatesByRange = useMemo(() => {
    const m = new Map<string, EntitySpanResponse[]>();
    for (const c of conflictSets) m.set(`${c.start}-${c.end}`, c.spans);
    return m;
  }, [conflictSets]);

  const preview = useMemo(() => previewBytes(file), [file]);
  const stale = useMemo(() => isSavedOutputStale(file), [file]);

  const surrogateDisplaySpans = useMemo(() => {
    if (!preview || preview.mode !== 'surrogate_annotated') return [];
    return dedupeSpansKeepPrimary(preview.spans);
  }, [preview]);

  const handleChangeSpans = (spans: EntitySpanResponse[]) => {
    updateFile(datasetId, file.id, { annotations: spans });
  };

  const updateSpanByKey = (key: string, patch: Partial<EntitySpanResponse>) => {
    const next = file.annotations.map((s) => (entitySpanKey(s) === key ? { ...s, ...patch } : s));
    updateFile(datasetId, file.id, { annotations: next });
  };

  const deleteSpanByKey = (key: string) => {
    const next = file.annotations.filter((s) => entitySpanKey(s) !== key);
    updateFile(datasetId, file.id, { annotations: next });
    setSpanPopover(null);
    setActiveSpanKey((ak) => (ak === key ? null : ak));
  };

  const handleSpanResize = useCallback(
    (key: string, start: number, end: number) => {
      setSaveError(null);
      const f = useProductionStore
        .getState()
        .datasets[datasetId]?.files.find((x) => x.id === file.id);
      if (!f) return;
      updateFile(datasetId, file.id, {
        annotations: f.annotations.map((s) =>
          entitySpanKey(s) === key
            ? { ...s, start, end, text: f.originalText.slice(start, end) }
            : s,
        ),
      });
    },
    [datasetId, file.id, updateFile],
  );

  const handleReset = () => {
    if (file.detectedAt) {
      updateFile(datasetId, file.id, { annotations: file.detectedAt });
    }
  };

  const handleResolveConflict = useCallback(
    (kept: EntitySpanResponse) => {
      updateFile(datasetId, file.id, {
        annotations: resolveConflictKeepSpan(file.annotations, kept),
      });
    },
    [datasetId, file.id, file.annotations, updateFile],
  );

  const handleDropConflict = useCallback(
    (range: { start: number; end: number }) => {
      updateFile(datasetId, file.id, {
        annotations: resolveConflictDropAll(file.annotations, range),
      });
    },
    [datasetId, file.id, file.annotations, updateFile],
  );

  const handleQuickResolve = useCallback(() => {
    updateFile(datasetId, file.id, {
      annotations: mergeLabelPrioritySpans(file.annotations),
    });
  }, [datasetId, file.id, file.annotations, updateFile]);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    setIsSaving(true);
    try {
      const f = useProductionStore
        .getState()
        .datasets[datasetId]?.files.find((x) => x.id === file.id);
      if (!f) return;
      const output = await buildSavedOutput({ file: f, mode: saveMode, reviewer });
      saveFileOutput(datasetId, file.id, output);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setIsSaving(false);
    }
  }, [datasetId, file.id, reviewer, saveFileOutput, saveMode]);

  const commitNote = () => {
    updateFile(datasetId, file.id, { note: note.trim() || undefined });
  };

  const toggleFlagged = () => {
    updateFile(datasetId, file.id, { flagged: !file.flagged });
  };

  const toggleResolved = () => {
    setFileResolved(datasetId, file.id, !file.resolved);
  };

  const addSpanFromGhost = () => {
    if (!ghostSelection) return;
    const exists = file.annotations.some(
      (s) =>
        s.start === ghostSelection.start &&
        s.end === ghostSelection.end &&
        s.label === addLabel,
    );
    if (!exists) {
      const next: EntitySpanResponse = {
        start: ghostSelection.start,
        end: ghostSelection.end,
        label: addLabel,
        text: ghostSelection.text,
        confidence: null,
        source: 'manual',
      };
      const merged = [...file.annotations, next].sort(
        (a, b) => a.start - b.start || a.end - b.end,
      );
      updateFile(datasetId, file.id, { annotations: merged });
      setFlashSpanKey(entitySpanKey(next));
    }
    setGhostSelection(null);
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const activeEl = document.activeElement as HTMLElement | null;
      if (!activeEl || !root.contains(activeEl)) return;
      if (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.tagName === 'SELECT' ||
        activeEl.isContentEditable
      ) {
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && ghostSelection) {
        e.preventDefault();
        addSpanFromGhost();
        return;
      }
      if (e.key === ']' || e.key === '[') {
        if (conflictSets.length === 0) return;
        e.preventDefault();
        const direction: 1 | -1 = e.key === ']' ? 1 : -1;
        const currentIdx = conflictSets.findIndex(
          (c) => activeSpanKey != null && c.spans.some((s) => entitySpanKey(s) === activeSpanKey),
        );
        const next =
          currentIdx < 0
            ? direction > 0
              ? 0
              : conflictSets.length - 1
            : (currentIdx + direction + conflictSets.length) % conflictSets.length;
        const c = conflictSets[next];
        const preferred = c.spans[0];
        if (preferred) setActiveSpanKey(entitySpanKey(preferred));
        setPulseRange({ start: c.start, end: c.end });
        highlighterRef.current?.scrollToRange(c.start, c.end);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeSpanKey, conflictSets, ghostSelection]);

  const leftColumnHeader = (
    <div className="flex w-full items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <ColorKeyPopover />
        {uniqueLabels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {uniqueLabels.slice(0, 5).map((l) => (
              <LabelBadge key={l} label={l} />
            ))}
            {uniqueLabels.length > 5 && (
              <span className="text-[10px] text-gray-400">+{uniqueLabels.length - 5}</span>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setOutputCollapsed((c) => !c)}
        className="shrink-0 inline-flex items-center gap-0.5 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600 hover:bg-gray-50"
        title={outputCollapsed ? 'Show output column' : 'Hide output column'}
      >
        {outputCollapsed ? <PanelRightOpen size={11} /> : <PanelRightClose size={11} />}
        {outputCollapsed ? 'Output' : 'Hide'}
      </button>
    </div>
  );

  const statusLine = (() => {
    if (!file.savedOutput) return 'No saved output';
    const t = formatSavedAt(file.savedOutput.savedAt);
    const label = MODE_LABELS[file.savedOutput.mode];
    return `Saved · ${label} · ${t}${stale ? ' · stale' : ''}`;
  })();

  const rightColumnHeader = (
    <div className="flex w-full min-w-0 items-center justify-between gap-2">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        Output
      </span>
      <span
        className={`min-w-0 truncate text-[10px] ${
          stale ? 'text-amber-700' : 'text-gray-500'
        }`}
        title={statusLine}
      >
        {statusLine}
      </span>
    </div>
  );

  const renderRightPane = () => {
    if (saveError) {
      return (
        <p className="mb-2 rounded border border-red-100 bg-red-50/90 px-2 py-1 text-xs text-red-800">
          {saveError}
        </p>
      );
    }
    if (!preview) {
      return (
        <p className="text-xs text-gray-400">
          No saved output yet. Use{' '}
          <strong className="font-medium text-gray-500">Save</strong> in the Spans panel
          to capture the current annotations.
        </p>
      );
    }
    if (preview.mode === 'annotated') {
      return <SpanHighlighter text={preview.text} spans={preview.spans} />;
    }
    if (preview.mode === 'redacted') {
      return <RedactedView text={preview.text} />;
    }
    if (surrogateDisplaySpans.length > 0) {
      return <SpanHighlighter text={preview.text} spans={surrogateDisplaySpans} />;
    }
    return <RedactedView text={preview.text} />;
  };

  const saveControl = (
    <SaveOutputButton
      mode={saveMode}
      onModeChange={setSaveMode}
      onSave={handleSave}
      isSaving={isSaving}
      isStale={stale}
      block
    />
  );

  return (
    <section ref={rootRef} className="flex min-h-0 flex-1 flex-col" tabIndex={-1}>
      <header className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-2 shadow-sm">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-gray-900">
            {file.sourceLabel}
          </span>
          <span className="text-[11px] text-gray-400">
            {file.originalText.length} chars · {file.annotations.length} spans
            {file.processingTimeMs != null && ` · ${file.processingTimeMs.toFixed(0)}ms detect`}
            {file.lastDetectionTarget && ` · via ${file.lastDetectionTarget}`}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {annotationsDiffer && (
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              title="Reset spans to last detection output"
            >
              <RotateCcw size={12} />
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={toggleFlagged}
            className={`flex items-center gap-1 rounded border px-3 py-1.5 text-xs font-medium ${
              file.flagged
                ? 'border-amber-300 bg-amber-100 text-amber-900'
                : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
            }`}
          >
            <Flag size={12} />
            {file.flagged ? 'Flagged' : 'Flag'}
          </button>
          <button
            type="button"
            onClick={toggleResolved}
            className={`flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium ${
              file.resolved
                ? 'bg-green-700 text-white hover:bg-green-800'
                : 'border border-green-200 bg-green-50 text-green-800 hover:bg-green-100'
            }`}
            title="Mark annotations final for export"
          >
            <CheckCircle2 size={12} />
            {file.resolved ? 'Resolved' : 'Mark resolved'}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ReviewerDualPane
            outputCollapsed={outputCollapsed}
            leftHeader={leftColumnHeader}
            rightHeader={rightColumnHeader}
            left={
              <div className="relative">
                <SpanHighlighter
                  ref={highlighterRef}
                  text={file.originalText}
                  spans={file.annotations}
                  activeSpanKey={activeSpanKey}
                  flashSpanKey={flashSpanKey}
                  onSpanHover={setActiveSpanKey}
                  onSpanClick={(span, key, anchor) => {
                    setSpanPopover({
                      key,
                      span,
                      left: Math.max(8, Math.min(anchor.left, window.innerWidth - 220)),
                      top: anchor.bottom + 6,
                    });
                    setSpanLabelDraft(span.label);
                  }}
                  onUncoveredSelection={(sel) => setGhostSelection(sel)}
                  onClearPendingSelection={() => setGhostSelection(null)}
                  pendingGhostRange={ghostSelection}
                  pulseRange={pulseRange}
                  overlapConflictRangeKeys={overlapConflictRangeKeys}
                  overlapSpanCandidatesByRange={overlapSpanCandidatesByRange}
                  onOverlapConflictClick={(_rangeKey, spans) => {
                    const kept = spans[0];
                    if (!kept) return;
                    setActiveSpanKey(entitySpanKey(kept));
                    setPulseRange({ start: kept.start, end: kept.end });
                    highlighterRef.current?.scrollToRange(kept.start, kept.end);
                  }}
                  onSpanResize={handleSpanResize}
                />
                {ghostSelection && (
                  <div className="pointer-events-auto sticky bottom-0 left-0 right-0 mt-3 flex flex-wrap items-center gap-2 rounded border border-amber-200 bg-amber-50/95 px-2 py-2 text-[11px] text-amber-950 shadow-sm">
                    <span className="font-medium">Add as:</span>
                    <select
                      value={addLabel}
                      onChange={(e) => setAddLabel(e.target.value)}
                      className="rounded border border-amber-200 bg-white px-2 py-0.5 text-gray-700"
                    >
                      {CANONICAL_LABELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={addSpanFromGhost}
                      className="inline-flex items-center gap-1 rounded bg-amber-600 px-2 py-0.5 text-white hover:bg-amber-700"
                    >
                      <Plus size={11} />
                      Add span
                    </button>
                    <button
                      type="button"
                      onClick={() => setGhostSelection(null)}
                      className="text-[10px] text-amber-800/80 underline hover:text-amber-950"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            }
            right={<div className="min-h-[120px] text-sm">{renderRightPane()}</div>}
          />
        </div>
        {!hideEditorPanel && (
          <aside className="flex w-[min(38%,520px)] min-w-[280px] max-w-[560px] shrink-0 flex-col border-l border-gray-200 bg-gray-50/90">
            <SpanEditor
              originalText={file.originalText}
              spans={file.annotations}
              onChange={handleChangeSpans}
              onReset={handleReset}
              isApplying={isSaving}
              isDirty={annotationsDiffer}
              error={saveError}
              ghostSelection={ghostSelection}
              onClearGhostSelection={() => setGhostSelection(null)}
              onNavigateToGhost={() => {
                if (!ghostSelection) return;
                highlighterRef.current?.scrollToRange(ghostSelection.start, ghostSelection.end);
                setPulseRange({ start: ghostSelection.start, end: ghostSelection.end });
              }}
              activeSpanKey={activeSpanKey}
              onActiveSpanKeyChange={setActiveSpanKey}
              conflictSets={conflictSets}
              onResolveConflict={handleResolveConflict}
              onDropConflict={handleDropConflict}
              onQuickResolveLabelPriority={handleQuickResolve}
              saveControl={saveControl}
              showGhostPanel={false}
            />
          </aside>
        )}
      </div>

      <div className="shrink-0 border-t border-gray-200 bg-white px-3 py-2">
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-medium text-gray-500">Reviewer note</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={commitNote}
            placeholder="Optional — stored with this file and in export metadata"
            className="flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800 focus:border-blue-400 focus:outline-none"
          />
        </div>
      </div>
      {spanPopover && (
        <div
          ref={popoverRef}
          className="fixed z-50 w-56 rounded-lg border border-gray-200 bg-white p-2 shadow-lg"
          style={{ left: spanPopover.left, top: spanPopover.top }}
        >
          <div className="mb-1.5 text-[10px] font-semibold uppercase text-gray-500">Span label</div>
          <div className="mb-2 text-[9px] leading-snug text-gray-400">
            [{spanPopover.span.start}-{spanPopover.span.end}]
          </div>
          <input
            value={spanLabelDraft}
            onChange={(e) => setSpanLabelDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const next = spanLabelDraft.trim();
              if (!next) return;
              updateSpanByKey(spanPopover.key, { label: next });
              setSpanPopover((p) => (p ? { ...p, span: { ...p.span, label: next } } : null));
            }}
            className="mb-2 w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-800"
            placeholder="Type label"
            autoFocus
          />
          <button
            type="button"
            onClick={() => {
              const next = spanLabelDraft.trim();
              if (!next) return;
              updateSpanByKey(spanPopover.key, { label: next });
              setSpanPopover((p) => (p ? { ...p, span: { ...p.span, label: next } } : null));
            }}
            className="mb-1.5 w-full rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
          >
            Apply label
          </button>
          <button
            type="button"
            onClick={() => deleteSpanByKey(spanPopover.key)}
            className="w-full rounded border border-red-100 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            Delete span
          </button>
        </div>
      )}
    </section>
  );
}
