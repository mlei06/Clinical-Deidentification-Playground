import { useState, useMemo, useEffect } from 'react';
import { CheckCircle2, Flag, SkipForward, Loader2, Columns2 } from 'lucide-react';
import SpanHighlighter from '../shared/SpanHighlighter';
import RedactedView from '../shared/RedactedView';
import LabelBadge from '../shared/LabelBadge';
import SpanEditor from '../inference/SpanEditor';
import { redactDocument } from '../../api/process';
import { useReviewQueue, type QueueDoc } from './store';
import type { OutputMode, PHISpanResponse } from '../../api/types';

interface DocumentReviewerProps {
  doc: QueueDoc;
  reviewer: string;
}

export default function DocumentReviewer({ doc, reviewer }: DocumentReviewerProps) {
  const { updateDoc, advance } = useReviewQueue();
  const [outputMode, setOutputMode] = useState<OutputMode>('redacted');
  const [isApplying, setIsApplying] = useState(false);
  const [redactError, setRedactError] = useState<string | null>(null);
  const [note, setNote] = useState(doc.note ?? '');

  useEffect(() => {
    setNote(doc.note ?? '');
    setRedactError(null);
  }, [doc.id]);

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

  const handleChangeSpans = (spans: PHISpanResponse[]) => {
    updateDoc(doc.id, { editedSpans: spans });
  };

  const handleReset = () => {
    updateDoc(doc.id, { editedSpans: doc.detectedSpans });
  };

  const handleApply = async () => {
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
    } catch (err) {
      setRedactError(err instanceof Error ? err.message : 'redact failed');
    } finally {
      setIsApplying(false);
    }
  };

  const commitReview = async (status: 'reviewed' | 'flagged' | 'skipped') => {
    if (status === 'skipped') {
      advance();
      return;
    }
    // Ensure we have a current redacted text reflecting edits.
    let redactedText = doc.redactedText;
    if (originalIsDirty || !redactedText) {
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
        redactedText = res.output_text;
      } catch (err) {
        setRedactError(err instanceof Error ? err.message : 'redact failed');
        return;
      }
    }
    updateDoc(doc.id, {
      status,
      note: note.trim() || undefined,
      redactedText,
      reviewedAt: new Date().toISOString(),
    });
    advance();
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

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-px overflow-hidden bg-gray-200">
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
          <div className="flex-1 overflow-auto p-3 text-sm">
            <SpanHighlighter text={doc.text} spans={doc.editedSpans} />
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
      </div>

      <div className="border-t border-gray-200 bg-gray-50 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 shadow-sm">
          <span className="text-[11px] font-medium text-gray-500">Output style</span>
          <select
            className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800"
            value={outputMode}
            onChange={(e) => setOutputMode(e.target.value as OutputMode)}
            title="Redacted tags or surrogate text for the output pane"
          >
            <option value="redacted">Redacted tags</option>
            <option value="surrogate">Surrogate data</option>
          </select>
          <button
            type="button"
            onClick={() => void handleApply()}
            disabled={isApplying}
            className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-900 hover:bg-blue-100 disabled:opacity-40"
          >
            {isApplying ? 'Applying…' : 'Apply output'}
          </button>
        </div>
        <SpanEditor
          originalText={doc.text}
          spans={doc.editedSpans}
          onChange={handleChangeSpans}
          onReset={handleReset}
          isApplying={isApplying}
          isDirty={originalIsDirty}
          error={redactError}
        />
        <div className="mt-2 flex items-center gap-2">
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
