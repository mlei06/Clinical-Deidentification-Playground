import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { CheckCircle2, Flag, SkipForward, Loader2, Columns2, Wand2, Plus } from 'lucide-react';
import SpanHighlighter, { type SpanHighlighterHandle } from '../shared/SpanHighlighter';
import RedactedView from '../shared/RedactedView';
import LabelBadge from '../shared/LabelBadge';
import SpanEditor from '../shared/SpanEditor';
import { redactDocument } from '../../api/production';
import { useReviewQueue, type QueueDoc } from './store';
import { CANONICAL_LABELS } from '../../lib/canonicalLabels';
import { phiSpanKey } from '../../lib/phiSpanKey';
import {
  findConflictSets,
  mergeLabelPrioritySpans,
  resolveConflictDropAll,
  resolveConflictKeepSpan,
} from '../../lib/spanOverlapConflicts';
import type { OutputMode, PHISpanResponse } from '../../api/types';

interface DocumentReviewerProps {
  doc: QueueDoc;
  reviewer: string;
}

interface GhostSelection {
  start: number;
  end: number;
  text: string;
}

export default function DocumentReviewer({ doc, reviewer }: DocumentReviewerProps) {
  const { updateDoc, advance } = useReviewQueue();
  const [outputMode, setOutputMode] = useState<OutputMode>('redacted');
  const [isApplying, setIsApplying] = useState(false);
  const [redactError, setRedactError] = useState<string | null>(null);
  const [note, setNote] = useState(doc.note ?? '');
  const [activeSpanKey, setActiveSpanKey] = useState<string | null>(null);
  const [flashSpanKey, setFlashSpanKey] = useState<string | null>(null);
  const [ghostSelection, setGhostSelection] = useState<GhostSelection | null>(null);
  const [pulseRange, setPulseRange] = useState<{ start: number; end: number } | null>(null);
  const [addLabel, setAddLabel] = useState<string>('OTHER');
  const highlighterRef = useRef<SpanHighlighterHandle>(null);

  useEffect(() => {
    setNote(doc.note ?? '');
    setRedactError(null);
    setActiveSpanKey(null);
    setFlashSpanKey(null);
    setGhostSelection(null);
    setPulseRange(null);
  }, [doc.id]);

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
    () => [...new Set(doc.editedSpans.map((s) => s.label))].sort(),
    [doc.editedSpans],
  );

  const originalIsDirty = useMemo(() => {
    if (doc.editedSpans.length !== doc.detectedSpans.length) return true;
    return doc.editedSpans.some((s, i) => {
      const o = doc.detectedSpans[i];
      return !o || s.start !== o.start || s.end !== o.end || s.label !== o.label;
    });
  }, [doc.editedSpans, doc.detectedSpans]);

  const conflictSets = useMemo(
    () => findConflictSets(doc.editedSpans, doc.text),
    [doc.editedSpans, doc.text],
  );

  const overlapConflictRangeKeys = useMemo(
    () => new Set(conflictSets.map((c) => `${c.start}-${c.end}`)),
    [conflictSets],
  );

  const overlapSpanCandidatesByRange = useMemo(() => {
    const m = new Map<string, PHISpanResponse[]>();
    for (const c of conflictSets) m.set(`${c.start}-${c.end}`, c.spans);
    return m;
  }, [conflictSets]);

  const handleChangeSpans = (spans: PHISpanResponse[]) => {
    updateDoc(doc.id, { editedSpans: spans });
  };

  const handleReset = () => {
    updateDoc(doc.id, { editedSpans: doc.detectedSpans });
  };

  const handleResolveConflict = useCallback(
    (kept: PHISpanResponse) => {
      updateDoc(doc.id, { editedSpans: resolveConflictKeepSpan(doc.editedSpans, kept) });
    },
    [doc.id, doc.editedSpans, updateDoc],
  );

  const handleDropConflict = useCallback(
    (range: { start: number; end: number }) => {
      updateDoc(doc.id, { editedSpans: resolveConflictDropAll(doc.editedSpans, range) });
    },
    [doc.id, doc.editedSpans, updateDoc],
  );

  const handleQuickResolve = useCallback(() => {
    updateDoc(doc.id, { editedSpans: mergeLabelPrioritySpans(doc.editedSpans) });
  }, [doc.id, doc.editedSpans, updateDoc]);

  const regenerateRedacted = useCallback(async () => {
    setRedactError(null);
    setIsApplying(true);
    try {
      const res = await redactDocument(
        {
          text: doc.text,
          spans: doc.editedSpans.map((s) => ({
            start: s.start,
            end: s.end,
            label: s.label,
          })),
          output_mode: outputMode,
        },
        reviewer || 'production-ui',
      );
      updateDoc(doc.id, { redactedText: res.output_text });
      return res.output_text;
    } catch (err) {
      setRedactError(err instanceof Error ? err.message : 'redact failed');
      return null;
    } finally {
      setIsApplying(false);
    }
  }, [doc.editedSpans, doc.id, doc.text, outputMode, reviewer, updateDoc]);

  const commitReview = async (status: 'reviewed' | 'flagged' | 'skipped') => {
    if (status === 'skipped') {
      advance();
      return;
    }
    let redactedText = doc.redactedText;
    if (originalIsDirty || !redactedText) {
      const next = await regenerateRedacted();
      if (next == null) return;
      redactedText = next;
    }
    updateDoc(doc.id, {
      status,
      note: note.trim() || undefined,
      redactedText,
      reviewedAt: new Date().toISOString(),
    });
    advance();
  };

  const addSpanFromGhost = () => {
    if (!ghostSelection) return;
    const exists = doc.editedSpans.some(
      (s) =>
        s.start === ghostSelection.start &&
        s.end === ghostSelection.end &&
        s.label === addLabel,
    );
    if (!exists) {
      const next: PHISpanResponse = {
        start: ghostSelection.start,
        end: ghostSelection.end,
        label: addLabel,
        text: ghostSelection.text,
        confidence: null,
        source: 'manual',
      };
      const merged = [...doc.editedSpans, next].sort(
        (a, b) => a.start - b.start || a.end - b.end,
      );
      updateDoc(doc.id, { editedSpans: merged });
      setFlashSpanKey(phiSpanKey(next));
    }
    setGhostSelection(null);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-gray-900">{doc.sourceName}</span>
          <span className="text-[11px] text-gray-400">
            {doc.text.length} chars · {doc.editedSpans.length} spans
            {doc.processingTimeMs != null && ` · ${doc.processingTimeMs.toFixed(0)}ms detect`}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={outputMode}
            onChange={(e) => setOutputMode(e.target.value as OutputMode)}
            className="rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700"
            title="Output mode for re-redaction"
          >
            <option value="redacted">Redacted tags</option>
            <option value="surrogate">Surrogate data</option>
          </select>
          <button
            type="button"
            onClick={() => void regenerateRedacted()}
            disabled={isApplying || doc.editedSpans.length === 0}
            className="flex items-center gap-1 rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            title="Regenerate the redacted output from current spans"
          >
            {isApplying ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            Apply
          </button>
          <button
            type="button"
            onClick={() => commitReview('skipped')}
            className="flex items-center gap-1 rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <SkipForward size={12} />
            Skip
          </button>
          <button
            type="button"
            onClick={() => commitReview('flagged')}
            className="flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
          >
            <Flag size={12} />
            Flag
          </button>
          <button
            type="button"
            onClick={() => commitReview('reviewed')}
            disabled={isApplying}
            className="flex items-center gap-1 rounded bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-800 disabled:opacity-40"
          >
            {isApplying ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            Approve & next
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
              text={doc.text}
              spans={doc.editedSpans}
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
              Redacted output ({outputMode})
            </span>
          </div>
          <div className="flex-1 overflow-auto p-3 text-sm">
            <RedactedView text={doc.redactedText} />
          </div>
        </div>
        <aside className="flex min-h-0 flex-col border-l border-gray-200 bg-gray-50 p-2">
          <SpanEditor
            originalText={doc.text}
            spans={doc.editedSpans}
            onChange={handleChangeSpans}
            onReset={handleReset}
            isApplying={isApplying}
            isDirty={originalIsDirty}
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
            onUpdateOutput={() => void regenerateRedacted()}
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
            placeholder="Optional — stored with this doc in the batch manifest"
            className="flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800 focus:border-blue-400 focus:outline-none"
          />
        </div>
      </div>
    </section>
  );
}
