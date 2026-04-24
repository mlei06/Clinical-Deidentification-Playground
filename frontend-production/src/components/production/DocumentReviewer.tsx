import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  CheckCircle2,
  Flag,
  Loader2,
  Columns2,
  Wand2,
  Plus,
  RotateCcw,
} from 'lucide-react';
import SpanHighlighter, { type SpanHighlighterHandle } from '../shared/SpanHighlighter';
import RedactedView from '../shared/RedactedView';
import LabelBadge from '../shared/LabelBadge';
import SpanEditor from '../shared/SpanEditor';
import { redactDocument } from '../../api/production';
import { useProductionStore, type DatasetFile } from './store';
import { CANONICAL_LABELS } from '../../lib/canonicalLabels';
import { entitySpanKey } from '../../lib/entitySpanKey';
import {
  findConflictSets,
  mergeLabelPrioritySpans,
  resolveConflictDropAll,
  resolveConflictKeepSpan,
} from '../../lib/spanOverlapConflicts';
import type { OutputMode, EntitySpanResponse } from '../../api/types';

interface DocumentReviewerProps {
  datasetId: string;
  file: DatasetFile;
  reviewer: string;
}

interface GhostSelection {
  start: number;
  end: number;
  text: string;
}

export default function DocumentReviewer({
  datasetId,
  file,
  reviewer,
}: DocumentReviewerProps) {
  const updateFile = useProductionStore((s) => s.updateFile);
  const setFileResolved = useProductionStore((s) => s.setFileResolved);

  const [previewMode, setPreviewMode] = useState<OutputMode>('redacted');
  const [previewText, setPreviewText] = useState<string>('');
  const [isApplying, setIsApplying] = useState(false);
  const [redactError, setRedactError] = useState<string | null>(null);
  const [note, setNote] = useState(file.note ?? '');
  const [activeSpanKey, setActiveSpanKey] = useState<string | null>(null);
  const [flashSpanKey, setFlashSpanKey] = useState<string | null>(null);
  const [ghostSelection, setGhostSelection] = useState<GhostSelection | null>(null);
  const [pulseRange, setPulseRange] = useState<{ start: number; end: number } | null>(
    null,
  );
  const [addLabel, setAddLabel] = useState<string>('OTHER');
  const highlighterRef = useRef<SpanHighlighterHandle>(null);

  useEffect(() => {
    setNote(file.note ?? '');
    setRedactError(null);
    setActiveSpanKey(null);
    setFlashSpanKey(null);
    setGhostSelection(null);
    setPulseRange(null);
    setPreviewText('');
  }, [file.id]);

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

  const handleChangeSpans = (spans: EntitySpanResponse[]) => {
    updateFile(datasetId, file.id, { annotations: spans });
  };

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

  const regeneratePreview = useCallback(async () => {
    setRedactError(null);
    setIsApplying(true);
    try {
      const res = await redactDocument(
        {
          text: file.originalText,
          spans: file.annotations.map((s) => ({
            start: s.start,
            end: s.end,
            label: s.label,
          })),
          output_mode: previewMode,
        },
        reviewer || 'production-ui',
      );
      setPreviewText(res.output_text);
    } catch (err) {
      setRedactError(err instanceof Error ? err.message : 'redact failed');
    } finally {
      setIsApplying(false);
    }
  }, [file.annotations, file.originalText, previewMode, reviewer]);

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

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-gray-900">
            {file.sourceLabel}
          </span>
          <span className="text-[11px] text-gray-400">
            {file.originalText.length} chars · {file.annotations.length} spans
            {file.processingTimeMs != null &&
              ` · ${file.processingTimeMs.toFixed(0)}ms detect`}
            {file.lastDetectionTarget && ` · via ${file.lastDetectionTarget}`}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={previewMode}
            onChange={(e) => setPreviewMode(e.target.value as OutputMode)}
            className="rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700"
            title="Preview mode (does not change export)"
          >
            <option value="redacted">Preview: redacted</option>
            <option value="surrogate">Preview: surrogate</option>
          </select>
          <button
            type="button"
            onClick={() => void regeneratePreview()}
            disabled={isApplying || file.annotations.length === 0}
            className="flex items-center gap-1 rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            title="Regenerate the preview pane from current spans"
          >
            {isApplying ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            Preview
          </button>
          {annotationsDiffer && (
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
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

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr_320px] gap-px overflow-hidden bg-gray-200">
        <div className="flex min-h-0 flex-col bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            <span>Original · spans</span>
            {uniqueLabels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {uniqueLabels.slice(0, 6).map((l) => (
                  <LabelBadge key={l} label={l} />
                ))}
                {uniqueLabels.length > 6 && (
                  <span className="text-[10px] text-gray-400">
                    +{uniqueLabels.length - 6}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="relative flex-1 overflow-auto p-3 pt-6 text-sm">
            <SpanHighlighter
              ref={highlighterRef}
              text={file.originalText}
              spans={file.annotations}
              activeSpanKey={activeSpanKey}
              flashSpanKey={flashSpanKey}
              onSpanHover={setActiveSpanKey}
              onUncoveredSelection={(sel) => setGhostSelection(sel)}
              onClearPendingSelection={() => setGhostSelection(null)}
              pendingGhostRange={ghostSelection}
              pulseRange={pulseRange}
              overlapConflictRangeKeys={overlapConflictRangeKeys}
              overlapSpanCandidatesByRange={overlapSpanCandidatesByRange}
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
        </div>
        <div className="flex min-h-0 flex-col bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            <span className="flex items-center gap-1">
              <Columns2 size={11} />
              Preview ({previewMode})
            </span>
          </div>
          <div className="flex-1 overflow-auto p-3 text-sm">
            <RedactedView text={previewText} />
          </div>
        </div>
        <aside className="flex min-h-0 flex-col border-l border-gray-200 bg-gray-50 p-2">
          <SpanEditor
            originalText={file.originalText}
            spans={file.annotations}
            onChange={handleChangeSpans}
            onReset={handleReset}
            isApplying={isApplying}
            isDirty={annotationsDiffer}
            error={redactError}
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
            onUpdateOutput={() => void regeneratePreview()}
          />
        </aside>
      </div>

      <div className="border-t border-gray-200 bg-white px-3 py-2">
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
    </section>
  );
}
