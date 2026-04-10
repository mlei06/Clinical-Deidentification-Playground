import { useMemo } from 'react';
import { labelColor } from '../../lib/labelColors';
import LabelBadge from './LabelBadge';
import type { PHISpanResponse } from '../../api/types';

interface SpanHighlighterProps {
  text: string;
  spans: PHISpanResponse[];
}

interface Segment {
  text: string;
  span: PHISpanResponse | null;
}

function buildSegments(text: string, spans: PHISpanResponse[]): Segment[] {
  if (spans.length === 0) return [{ text, span: null }];

  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const segments: Segment[] = [];
  let cursor = 0;

  for (const span of sorted) {
    if (span.start < cursor) continue; // skip overlapping
    if (span.start > cursor) {
      segments.push({ text: text.slice(cursor, span.start), span: null });
    }
    segments.push({ text: text.slice(span.start, span.end), span });
    cursor = span.end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), span: null });
  }

  return segments;
}

export default function SpanHighlighter({ text, spans }: SpanHighlighterProps) {
  const segments = useMemo(() => buildSegments(text, spans), [text, spans]);

  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed">
      {segments.map((seg, i) => {
        if (!seg.span) return <span key={i}>{seg.text}</span>;
        const c = labelColor(seg.span.label);
        return (
          <mark
            key={i}
            className="relative inline rounded-sm px-0.5"
            style={{ backgroundColor: c.bg, borderBottom: `2px solid ${c.border}` }}
            title={`${seg.span.label}${seg.span.confidence != null ? ` (${(seg.span.confidence * 100).toFixed(0)}%)` : ''}${seg.span.source ? ` — ${seg.span.source}` : ''}`}
          >
            <LabelBadge
              label={seg.span.label}
              className="absolute -top-4 left-0"
            />
            {seg.text}
          </mark>
        );
      })}
    </pre>
  );
}
