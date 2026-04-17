import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Loader2,
  Save,
  FolderOpen,
  FileJson,
  FileText,
  Trash2,
  ChevronDown,
  ChevronRight,
  PanelTop,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PipelineSelector from '../shared/PipelineSelector';
import TextInput from './TextInput';
import SpanHighlighter, { type SpanHighlighterHandle } from '../shared/SpanHighlighter';
import RedactedView from '../shared/RedactedView';
import TraceTimeline from './TraceTimeline';
import SpanEditor from './SpanEditor';
import ConflictResolutionPopover from './ConflictResolutionPopover';
import InferenceDualPane from './InferenceDualPane';
import InferenceRightPanel, { type InferenceRightTab } from './InferenceRightPanel';
import InferenceStatsTab from './InferenceStatsTab';
import { useProcessText, useRedactDocument } from '../../hooks/useProcess';
import {
  listInferenceRuns,
  saveInferenceSnapshot,
  getInferenceRun,
  deleteInferenceRun,
} from '../../api/inference';
import { downloadBlob } from '../../lib/download';
import { phiSpanKey } from '../../lib/phiSpanKey';
import { CANONICAL_LABELS } from '../../lib/canonicalLabels';
import { labelFamilyLegend, labelFamilySwatch } from '../../lib/labelColors';
import {
  buildConflictMapFromTrace,
  conflictsForFinalSpans,
  type SpanLabelConflict,
} from '../../lib/traceConflicts';
import {
  dedupeSpansKeepPrimary,
  findConflictSets,
  mergeLabelPrioritySpans,
  resolveConflictKeepSpan,
  spanRangeKey,
  type SpanConflictSet,
} from '../../lib/spanOverlapConflicts';
import type {
  OutputMode,
  PHISpanResponse,
  ProcessResponse,
  SavedInferenceRunDetail,
} from '../../api/types';

function toProcessResponse(d: SavedInferenceRunDetail): ProcessResponse {
  const { id: _id, saved_at: _saved, ...rest } = d;
  return rest;
}

function exportFilenameBase(pipelineName: string): string {
  const safe = pipelineName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64) || 'inference';
  const day = new Date().toISOString().slice(0, 10);
  return `${safe}_${day}`;
}

function InferenceLegendBar() {
  const items = labelFamilyLegend();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 bg-white px-2 py-1.5 text-[10px]">
      <span className="shrink-0 font-semibold uppercase tracking-wide text-gray-400">Color key</span>
      {items.map(({ family, title }) => {
        const sw = labelFamilySwatch(family);
        return (
          <span
            key={family}
            className="inline-flex items-center gap-1 text-gray-600"
            title={title}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: sw.bg, border: `1px solid ${sw.border}` }}
            />
            <span className="max-w-[140px] truncate">{title}</span>
          </span>
        );
      })}
    </div>
  );
}

export default function InferenceView() {
  const [pipeline, setPipeline] = useState('');
  const [text, setText] = useState('');
  const [outputMode, setOutputMode] = useState<OutputMode>('redacted');
  const [result, setResult] = useState<ProcessResponse | null>(null);
  const [snapshotMeta, setSnapshotMeta] = useState<{ id: string; saved_at: string } | null>(null);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [editedSpans, setEditedSpans] = useState<PHISpanResponse[] | null>(null);
  const [editOutputMode, setEditOutputMode] = useState<OutputMode>('redacted');
  const [redactError, setRedactError] = useState<string | null>(null);
  const [activeSpanKey, setActiveSpanKey] = useState<string | null>(null);
  const [ghostSelection, setGhostSelection] = useState<{
    start: number;
    end: number;
    text: string;
  } | null>(null);
  const [pulseRange, setPulseRange] = useState<{ start: number; end: number } | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<{
    start: number;
    end: number;
    text: string;
    left: number;
    top: number;
  } | null>(null);
  const [spanPopover, setSpanPopover] = useState<{
    key: string;
    span: PHISpanResponse;
    left: number;
    top: number;
  } | null>(null);
  const [conflictUI, setConflictUI] = useState<{
    c: SpanLabelConflict;
    spanKey: string;
    left: number;
    top: number;
  } | null>(null);
  const [overlapConflictPopover, setOverlapConflictPopover] = useState<{
    conflict: SpanConflictSet;
    anchor: DOMRect;
  } | null>(null);
  const [inputExpanded, setInputExpanded] = useState(true);
  const [rightTab, setRightTab] = useState<InferenceRightTab>('spans');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const highlighterRef = useRef<SpanHighlighterHandle>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const selectionMenuRef = useRef<HTMLDivElement>(null);
  const conflictRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const clearPendingSelection = useCallback(() => {
    setGhostSelection(null);
    setSelectionMenu(null);
    setOverlapConflictPopover(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const queryClient = useQueryClient();
  const mutation = useProcessText();
  const redactMutation = useRedactDocument();

  useEffect(() => {
    setEditedSpans(null);
    setRedactError(null);
    setGhostSelection(null);
    setSelectionMenu(null);
    setActiveSpanKey(null);
    setPulseRange(null);
    setSpanPopover(null);
    setConflictUI(null);
    if (result) {
      setEditOutputMode(
        result.redacted_text && result.redacted_text !== result.original_text
          ? 'redacted'
          : outputMode === 'annotated'
            ? 'redacted'
            : outputMode,
      );
      setInputExpanded(false);
    } else {
      setInputExpanded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.request_id, result?.pipeline_name]);

  useEffect(() => {
    if (!pulseRange) return;
    const t = window.setTimeout(() => setPulseRange(null), 1600);
    return () => window.clearTimeout(t);
  }, [pulseRange]);

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
    if (!exportMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (exportMenuRef.current?.contains(e.target as Node)) return;
      setExportMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [exportMenuOpen]);

  useEffect(() => {
    if (!ghostSelection && !selectionMenu) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      const host =
        t instanceof Element ? t : (t.parentNode instanceof Element ? t.parentNode : null);
      if (host?.closest('[data-inference-annotate-pane]')) return;
      if (selectionMenuRef.current?.contains(t)) return;
      if (host?.closest('[data-pending-selection-ui]')) return;
      clearPendingSelection();
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [ghostSelection, selectionMenu, clearPendingSelection]);

  useEffect(() => {
    if (!ghostSelection && !selectionMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      clearPendingSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ghostSelection, selectionMenu, clearPendingSelection]);

  useEffect(() => {
    if (!conflictUI) return;
    const onDown = (e: MouseEvent) => {
      if (conflictRef.current?.contains(e.target as Node)) return;
      setConflictUI(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [conflictUI]);

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

  const effectiveSpans: PHISpanResponse[] = editedSpans ?? result?.spans ?? [];

  const conflictSets = useMemo(() => {
    if (!result) return [] as SpanConflictSet[];
    return findConflictSets(effectiveSpans, result.original_text);
  }, [effectiveSpans, result]);

  const displaySpansForHighlighter = useMemo(
    () => dedupeSpansKeepPrimary(effectiveSpans),
    [effectiveSpans],
  );

  const overlapSpanCandidatesByRange = useMemo(() => {
    const m = new Map<string, PHISpanResponse[]>();
    for (const c of conflictSets) {
      m.set(spanRangeKey(c.start, c.end), c.spans);
    }
    return m;
  }, [conflictSets]);

  const overlapConflictRangeKeys = useMemo(
    () => new Set(conflictSets.map((c) => spanRangeKey(c.start, c.end))),
    [conflictSets],
  );

  const isDirty =
    editedSpans !== null &&
    result !== null &&
    (editedSpans.length !== result.spans.length ||
      editedSpans.some((s, i) => {
        const orig = result.spans[i];
        return !orig || s.start !== orig.start || s.end !== orig.end || s.label !== orig.label;
      }));

  const conflictBySpanKey = useMemo(() => {
    if (!result?.intermediary_trace) return new Map<string, SpanLabelConflict>();
    const rangeMap = buildConflictMapFromTrace(result.intermediary_trace);
    return conflictsForFinalSpans(rangeMap, effectiveSpans);
  }, [result?.intermediary_trace, effectiveSpans]);

  const handleEditedSpansChange = (spans: PHISpanResponse[]) => {
    setEditedSpans(spans);
    setRedactError(null);
  };

  const handleResetEdits = () => {
    setEditedSpans(null);
    setRedactError(null);
  };

  const handleUpdateOutput = () => {
    if (!result) return;
    /** Snapshot before apply so open conflicts remain editable after success. */
    const snapshot = [...effectiveSpans];
    const hadOpenConflicts =
      findConflictSets(snapshot, result.original_text).length > 0;
    /** One span per range for the API; unresolved overlaps use canonical primary for this run. */
    const spansPayload = dedupeSpansKeepPrimary(effectiveSpans);
    setRedactError(null);
    redactMutation.mutate(
      {
        text: result.original_text,
        spans: spansPayload.map((s) => ({ start: s.start, end: s.end, label: s.label })),
        output_mode: editOutputMode,
      },
      {
        onSuccess: (res) => {
          setResult({
            ...result,
            redacted_text: res.output_text,
            spans: spansPayload,
          });
          if (hadOpenConflicts) {
            setEditedSpans(snapshot);
          } else {
            setEditedSpans(null);
          }
          setSnapshotMeta(null);
          clearPendingSelection();
        },
        onError: (err: unknown) =>
          setRedactError(err instanceof Error ? err.message : 'Redaction failed'),
      },
    );
  };

  const replaceSpans = (next: PHISpanResponse[]) => {
    setEditedSpans(next);
    setRedactError(null);
  };

  /** Functional update avoids stale ``effectiveSpans`` when resolving from the popover after other edits. */
  const handleResolveOverlapConflict = useCallback(
    (kept: PHISpanResponse) => {
      setEditedSpans((prev) => {
        const base = prev ?? result?.spans ?? [];
        return resolveConflictKeepSpan(base, kept);
      });
      setRedactError(null);
      setOverlapConflictPopover(null);
      setConflictUI(null);
    },
    [result?.spans],
  );

  /** Matches ``resolve_spans`` with strategy ``label_priority`` (see ``span_merge.merge_label_priority``). */
  const handleQuickResolveLabelPriority = useCallback(() => {
    setEditedSpans((prev) => {
      const base = prev ?? result?.spans ?? [];
      return mergeLabelPrioritySpans(base);
    });
    setRedactError(null);
    setOverlapConflictPopover(null);
    setConflictUI(null);
  }, [result?.spans]);

  const handleOverlapConflictClick = (
    rangeKey: string,
    _candidates: PHISpanResponse[],
    anchor: DOMRect,
  ) => {
    const cs = conflictSets.find((c) => spanRangeKey(c.start, c.end) === rangeKey);
    if (!cs) return;
    setSpanPopover(null);
    setOverlapConflictPopover({ conflict: cs, anchor });
  };

  const updateSpanByKey = (key: string, patch: Partial<PHISpanResponse>) => {
    replaceSpans(effectiveSpans.map((s) => (phiSpanKey(s) === key ? { ...s, ...patch } : s)));
  };

  const deleteSpanByKey = (key: string) => {
    replaceSpans(effectiveSpans.filter((s) => phiSpanKey(s) !== key));
    setSpanPopover(null);
    if (activeSpanKey === key) setActiveSpanKey(null);
  };

  const addManualSpan = (label: string, sel: { start: number; end: number; text: string }) => {
    const next: PHISpanResponse = {
      start: sel.start,
      end: sel.end,
      label,
      text: sel.text,
      confidence: null,
      source: 'manual',
    };
    const k = phiSpanKey(next);
    if (effectiveSpans.some((s) => phiSpanKey(s) === k)) {
      clearPendingSelection();
      return;
    }
    const merged = [...effectiveSpans, next].sort((a, b) => a.start - b.start || a.end - b.end);
    replaceSpans(merged);
    clearPendingSelection();
  };

  const onUncoveredSelection = (
    sel: { start: number; end: number; text: string },
    anchor: DOMRect,
  ) => {
    setGhostSelection(sel);
    setSelectionMenu({
      ...sel,
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - 220)),
      top: anchor.bottom + 6,
    });
  };

  const runDisabled = !pipeline || !text.trim() || mutation.isPending;

  const traceFrames = result?.intermediary_trace;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top bar */}
      <header className="flex shrink-0 flex-wrap items-end gap-2 border-b border-gray-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex min-w-[140px] max-w-[220px] flex-1 flex-col gap-0.5">
          <span className="text-[10px] font-medium text-gray-500">Pipeline</span>
          <PipelineSelector value={pipeline} onChange={setPipeline} />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-medium text-gray-500">Run output</span>
          <select
            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800"
            value={outputMode}
            onChange={(e) => setOutputMode(e.target.value as OutputMode)}
          >
            <option value="annotated">Annotated</option>
            <option value="redacted">Redacted</option>
            <option value="surrogate">Surrogate</option>
          </select>
        </div>
        <button
          type="button"
          onClick={() => setInputExpanded((e) => !e)}
          className="flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
          title="Show or hide input text"
        >
          <PanelTop size={14} />
          Input
          {inputExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <button
          type="button"
          onClick={handleRun}
          disabled={runDisabled}
          className="flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40"
        >
          {mutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          Run
        </button>

        {result && (
          <>
            <div className="mx-1 h-8 w-px self-stretch bg-gray-200" />
            <div className="flex flex-wrap items-center gap-0 rounded-lg border border-gray-200 bg-slate-50/90 p-0.5 shadow-sm">
              <div className="flex items-center gap-1.5 px-2 py-1">
                <label
                  htmlFor="inference-view-style"
                  className="whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-gray-500"
                >
                  View style
                </label>
                <select
                  id="inference-view-style"
                  className="max-w-[140px] rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800"
                  value={editOutputMode}
                  onChange={(e) => setEditOutputMode(e.target.value as OutputMode)}
                  title="Redacted tags or surrogate text — used when you update output"
                >
                  <option value="redacted">Redacted</option>
                  <option value="surrogate">Surrogate</option>
                </select>
              </div>
              <div className="mx-0.5 h-6 w-px self-center bg-gray-200" />
              <button
                type="button"
                onClick={handleUpdateOutput}
                disabled={redactMutation.isPending || effectiveSpans.length === 0}
                title={
                  conflictSets.length > 0
                    ? 'Regenerates the Output column from your current spans and view style. Unresolved same-range overlaps use the canonical primary label for this run; duplicate labels stay in the sidebar until you resolve or use Quick resolve.'
                    : 'Regenerate the Output column from your current spans using the selected view style (redacted tags or surrogate).'
                }
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-800 bg-gray-100 px-2.5 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-200 disabled:opacity-40"
              >
                {redactMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
                {redactMutation.isPending ? 'Updating…' : 'Update output'}
              </button>
              <div className="mx-0.5 h-6 w-px self-center bg-gray-200" />
              <button
                type="button"
                disabled={!canSave}
                onClick={() => result && saveMutation.mutate(result)}
                className="flex items-center gap-1 rounded-md border border-transparent bg-white px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-white/80 disabled:opacity-40"
              >
                {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save snapshot
              </button>
              <div className="mx-0.5 h-6 w-px self-center bg-gray-200" />
              <div className="relative" ref={exportMenuRef}>
                <button
                  type="button"
                  onClick={() => setExportMenuOpen((o) => !o)}
                  className="flex items-center gap-1 rounded-md border border-transparent bg-white px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-white/80"
                  aria-expanded={exportMenuOpen}
                  aria-haspopup="menu"
                >
                  Export
                  <ChevronDown size={14} className="text-gray-500" />
                </button>
                {exportMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-md border border-gray-200 bg-white py-1 shadow-lg"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                      onClick={() => {
                        handleDownloadJson();
                        setExportMenuOpen(false);
                      }}
                    >
                      <FileJson size={14} className="shrink-0 text-gray-500" />
                      Export as JSON
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                      onClick={() => {
                        handleDownloadRedacted();
                        setExportMenuOpen(false);
                      }}
                    >
                      <FileText size={14} className="shrink-0 text-gray-500" />
                      Download output text
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        <div className="flex min-h-8 min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
          {runsLoading && <Loader2 size={12} className="animate-spin text-gray-400" />}
          <FolderOpen size={12} className="text-gray-400" />
          <select
            className="max-w-[200px] rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800"
            value={selectedRunId}
            disabled={runsLoading || loadMutation.isPending || savedRuns.length === 0}
            onChange={(e) => setSelectedRunId(e.target.value)}
          >
            <option value="">{savedRuns.length === 0 ? 'No snapshots' : 'Load snapshot…'}</option>
            {savedRuns.map((r) => (
              <option key={r.id} value={r.id}>
                {r.pipeline_name} · {r.saved_at.slice(0, 16)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!selectedRunId || loadMutation.isPending}
            onClick={() => selectedRunId && loadMutation.mutate(selectedRunId)}
            className="rounded border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            {loadMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Load'}
          </button>
          {selectedRunId && (
            <button
              type="button"
              title="Delete snapshot"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (selectedRunId && confirm('Delete this saved snapshot?')) {
                  deleteMutation.mutate(selectedRunId);
                }
              }}
              className="rounded border border-red-100 p-1 text-red-600 hover:bg-red-50"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </header>

      {inputExpanded && (
        <div className="shrink-0 border-b border-gray-100 bg-gray-50/50 px-3 py-2">
          <div className="mx-auto max-w-5xl">
            <div className="mb-1 text-xs font-medium text-gray-600">Input text</div>
            <TextInput value={text} onChange={setText} />
          </div>
        </div>
      )}

      {mutation.isError && (
        <div className="shrink-0 border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
          {(mutation.error as Error).message}
        </div>
      )}
      {loadMutation.isError && (
        <div className="shrink-0 border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
          {(loadMutation.error as Error).message}
        </div>
      )}
      {saveMutation.isError && (
        <div className="shrink-0 border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
          {(saveMutation.error as Error).message}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {result ? (
            <>
              <InferenceLegendBar />
              <InferenceDualPane
                left={
                  <SpanHighlighter
                    ref={highlighterRef}
                    text={result.original_text}
                    spans={displaySpansForHighlighter}
                    activeSpanKey={activeSpanKey}
                    onSpanHover={setActiveSpanKey}
                    onSpanClick={(_span, key, anchor) => {
                      setSpanPopover({
                        key,
                        span: _span,
                        left: Math.max(8, Math.min(anchor.left, window.innerWidth - 220)),
                        top: anchor.bottom + 6,
                      });
                    }}
                    onUncoveredSelection={onUncoveredSelection}
                    onClearPendingSelection={clearPendingSelection}
                    pendingGhostRange={ghostSelection}
                    pulseRange={pulseRange}
                    conflictBySpanKey={conflictBySpanKey}
                    onConflictClick={(c, anchor) => {
                      const span = effectiveSpans.find((s) => s.start === c.start && s.end === c.end);
                      if (!span) return;
                      setConflictUI({
                        c,
                        spanKey: phiSpanKey(span),
                        left: Math.max(8, Math.min(anchor.left, window.innerWidth - 280)),
                        top: anchor.bottom + 6,
                      });
                    }}
                    overlapConflictRangeKeys={overlapConflictRangeKeys}
                    overlapSpanCandidatesByRange={overlapSpanCandidatesByRange}
                    onOverlapConflictClick={handleOverlapConflictClick}
                  />
                }
                right={<RedactedView text={result.redacted_text} />}
              />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-gray-500">
              <p className="font-medium text-gray-700">No run yet</p>
              <p className="max-w-md text-xs text-gray-400">
                Set pipeline and input above, then Run. The annotated / output panes and tools appear
                here.
              </p>
            </div>
          )}
        </section>

        {result && (
          <aside className="flex w-[min(38%,520px)] min-w-[280px] max-w-[560px] shrink-0 flex-col border-l border-gray-200 bg-white">
            <InferenceRightPanel
              tab={rightTab}
              onTabChange={setRightTab}
              spansContent={
                <SpanEditor
                  originalText={result.original_text}
                  spans={effectiveSpans}
                  onChange={handleEditedSpansChange}
                  onReset={handleResetEdits}
                  isApplying={redactMutation.isPending}
                  isDirty={isDirty}
                  error={redactError}
                  ghostSelection={ghostSelection}
                  onClearGhostSelection={clearPendingSelection}
                  onNavigateToGhost={() => {
                    if (!ghostSelection) return;
                    highlighterRef.current?.scrollToRange(ghostSelection.start, ghostSelection.end);
                    setPulseRange({
                      start: ghostSelection.start,
                      end: ghostSelection.end,
                    });
                  }}
                  activeSpanKey={activeSpanKey}
                  onActiveSpanKeyChange={setActiveSpanKey}
                  conflictSets={conflictSets}
                  onResolveConflict={handleResolveOverlapConflict}
                  onQuickResolveLabelPriority={handleQuickResolveLabelPriority}
                />
              }
              statsContent={<InferenceStatsTab spans={effectiveSpans} />}
              traceContent={
                traceFrames && traceFrames.length > 0 ? (
                  <TraceTimeline frames={traceFrames} />
                ) : (
                  <p className="text-xs text-gray-400">No trace for this run.</p>
                )
              }
            />
          </aside>
        )}
      </div>

      {/* Floating label menu for unflagged selection */}
      {selectionMenu && result && (
        <div
          ref={selectionMenuRef}
          className="fixed z-50 w-56 rounded-lg border border-gray-200 bg-white p-2 shadow-xl"
          style={{ left: selectionMenu.left, top: selectionMenu.top }}
        >
          <div className="mb-1 text-[10px] font-semibold uppercase text-gray-500">Add PHI label</div>
          <select
            className="mb-2 w-full rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-800"
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              addManualSpan(v, {
                start: selectionMenu.start,
                end: selectionMenu.end,
                text: selectionMenu.text,
              });
              e.target.value = '';
            }}
          >
            <option value="">Choose label…</option>
            {CANONICAL_LABELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => clearPendingSelection()}
            className="w-full rounded border border-gray-200 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      )}

      <ConflictResolutionPopover
        open={Boolean(overlapConflictPopover && result)}
        onClose={() => setOverlapConflictPopover(null)}
        anchorRect={overlapConflictPopover?.anchor ?? null}
        originalText={result?.original_text ?? ''}
        conflict={overlapConflictPopover?.conflict ?? null}
        onKeep={handleResolveOverlapConflict}
      />

      {spanPopover && result && (
        <div
          ref={popoverRef}
          className="fixed z-50 w-52 rounded-lg border border-gray-200 bg-white p-2 shadow-lg"
          style={{ left: spanPopover.left, top: spanPopover.top }}
        >
          <div className="mb-1.5 text-[10px] font-semibold uppercase text-gray-500">Span</div>
          <select
            value={spanPopover.span.label}
            onChange={(e) => {
              updateSpanByKey(spanPopover.key, { label: e.target.value });
              setSpanPopover((p) =>
                p ? { ...p, span: { ...p.span, label: e.target.value } } : null,
              );
            }}
            className="mb-2 w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-800"
          >
            {CANONICAL_LABELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => deleteSpanByKey(spanPopover.key)}
            className="w-full rounded border border-red-100 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            Delete span
          </button>
        </div>
      )}

      {conflictUI && result && (
        <div
          ref={conflictRef}
          className="fixed z-50 max-w-xs rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs shadow-xl"
          style={{ left: conflictUI.left, top: conflictUI.top }}
        >
          <div className="mb-1 font-semibold text-amber-950">Label conflict</div>
          <p className="mb-2 text-amber-900/90">
            <span className="font-mono text-[10px]">{conflictUI.c.pipeA}</span>:{' '}
            <strong>{conflictUI.c.labelA}</strong>
            <br />
            <span className="font-mono text-[10px]">{conflictUI.c.pipeB}</span>:{' '}
            <strong>{conflictUI.c.labelB}</strong>
          </p>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              className="rounded bg-white px-2 py-1 text-left text-[11px] hover:bg-amber-100"
              onClick={() => {
                updateSpanByKey(conflictUI.spanKey, { label: conflictUI.c.labelA });
                setConflictUI(null);
              }}
            >
              Keep: {conflictUI.c.labelA}
            </button>
            <button
              type="button"
              className="rounded bg-white px-2 py-1 text-left text-[11px] hover:bg-amber-100"
              onClick={() => {
                updateSpanByKey(conflictUI.spanKey, { label: conflictUI.c.labelB });
                setConflictUI(null);
              }}
            >
              Keep: {conflictUI.c.labelB}
            </button>
          </div>
        </div>
      )}

      {result && snapshotMeta && (
        <div className="flex shrink-0 justify-end border-t border-gray-100 bg-gray-50/80 px-3 py-1.5 text-[10px] text-gray-400">
          <span className="truncate">
            Snapshot <code>{snapshotMeta.id}</code>
          </span>
        </div>
      )}
    </div>
  );
}
