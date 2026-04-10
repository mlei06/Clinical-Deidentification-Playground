import { useState } from 'react';
import { ChevronRight, ChevronDown, Clock } from 'lucide-react';
import SpanHighlighter from '../shared/SpanHighlighter';
import type { TraceFrame, PHISpanResponse } from '../../api/types';

interface TraceTimelineProps {
  frames: TraceFrame[];
}

function traceSpansToResponse(
  frame: TraceFrame,
): { text: string; spans: PHISpanResponse[] } | null {
  if (!frame.document) return null;
  const text = frame.document.document.text;
  const spans: PHISpanResponse[] = frame.document.spans.map((s) => ({
    ...s,
    text: text.slice(s.start, s.end),
  }));
  return { text, spans };
}

export default function TraceTimeline({ frames }: TraceTimelineProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
        Pipeline Trace ({frames.length} steps)
      </div>
      <div className="divide-y divide-gray-100">
        {frames.map((frame, i) => {
          const isOpen = expanded.has(i);
          const doc = traceSpansToResponse(frame);
          return (
            <div key={i}>
              <button
                onClick={() => toggle(i)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50"
              >
                {isOpen ? (
                  <ChevronDown size={14} className="text-gray-400" />
                ) : (
                  <ChevronRight size={14} className="text-gray-400" />
                )}
                <span className="flex-1 text-sm font-medium text-gray-700">
                  {frame.pipe_type}
                </span>
                {doc && (
                  <span className="text-xs text-gray-400">
                    {doc.spans.length} span{doc.spans.length !== 1 ? 's' : ''}
                  </span>
                )}
                {frame.elapsed_ms != null && (
                  <span className="flex items-center gap-0.5 text-xs text-gray-400">
                    <Clock size={11} />
                    {frame.elapsed_ms.toFixed(1)}ms
                  </span>
                )}
              </button>
              {isOpen && doc && (
                <div className="border-t border-gray-100 bg-gray-50 p-4">
                  <SpanHighlighter text={doc.text} spans={doc.spans} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
