import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import JSZip from 'jszip';
import { downloadBlob } from '../../lib/download';
import { redactDocument } from '../../api/process';
import type { OutputMode } from '../../api/types';
import type { QueueDoc } from './store';

interface BatchExportProps {
  docs: QueueDoc[];
  mode: string;
  reviewer: string;
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function baseName(name: string): string {
  return (name.replace(/[/\\]/g, '_').replace(/\s+/g, '_') || 'doc').slice(0, 120);
}

export default function BatchExport({ docs, mode, reviewer }: BatchExportProps) {
  const [includeSurrogate, setIncludeSurrogate] = useState(false);
  const [outputMode, setOutputMode] = useState<OutputMode>('redacted');
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reviewed = docs.filter((d) => d.status === 'reviewed');

  const handleExport = async () => {
    if (reviewed.length === 0) return;
    setError(null);
    setIsExporting(true);
    try {
      const zip = new JSZip();
      const manifestRows: string[] = [
        'source_name,status,span_count,reviewed_at,note',
      ];
      for (const d of reviewed) {
        let primary = d.redactedText;
        try {
          const res = await redactDocument(
            {
              text: d.text,
              spans: d.editedSpans.map((s) => ({
                start: s.start,
                end: s.end,
                label: s.label,
              })),
              output_mode: outputMode,
            },
            reviewer || 'production-ui',
          );
          primary = res.output_text;
        } catch {
          // fall back to committed redacted text
        }
        const stem = baseName(d.sourceName);
        zip.file(`${stem}.${outputMode}.txt`, primary);
        if (includeSurrogate && outputMode !== 'surrogate') {
          try {
            const res = await redactDocument(
              {
                text: d.text,
                spans: d.editedSpans.map((s) => ({
                  start: s.start,
                  end: s.end,
                  label: s.label,
                })),
                output_mode: 'surrogate',
              },
              reviewer || 'production-ui',
            );
            zip.file(`${stem}.surrogate.txt`, res.output_text);
          } catch {
            // skip surrogate for this doc
          }
        }
        // Per-doc spans JSON for downstream processing.
        zip.file(
          `${stem}.spans.json`,
          JSON.stringify(
            {
              source_name: d.sourceName,
              spans: d.editedSpans,
              note: d.note ?? null,
              reviewed_at: d.reviewedAt ?? null,
              mode,
              reviewer,
            },
            null,
            2,
          ),
        );
        manifestRows.push(
          [
            csvEscape(d.sourceName),
            d.status,
            String(d.editedSpans.length),
            d.reviewedAt ?? '',
            csvEscape(d.note ?? ''),
          ].join(','),
        );
      }
      zip.file('manifest.csv', manifestRows.join('\n') + '\n');
      zip.file(
        'batch.json',
        JSON.stringify(
          {
            mode,
            reviewer,
            output_mode: outputMode,
            reviewed_count: reviewed.length,
            exported_at: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
      const blob = await zip.generateAsync({ type: 'blob' });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(`deid_batch_${mode || 'export'}_${stamp}.zip`, blob, 'application/zip');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'export failed');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 bg-white px-4 py-2">
      <span className="text-xs font-medium text-gray-600">Batch export</span>
      <span className="text-[11px] text-gray-400">
        {reviewed.length} reviewed / {docs.length} total
      </span>
      <div className="ml-auto flex items-center gap-2">
        <select
          value={outputMode}
          onChange={(e) => setOutputMode(e.target.value as OutputMode)}
          className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
        >
          <option value="redacted">Redacted tags</option>
          <option value="surrogate">Surrogate</option>
        </select>
        <label className="flex items-center gap-1 text-[11px] text-gray-600">
          <input
            type="checkbox"
            checked={includeSurrogate}
            onChange={(e) => setIncludeSurrogate(e.target.checked)}
            disabled={outputMode === 'surrogate'}
          />
          Also include surrogate
        </label>
        <button
          type="button"
          onClick={handleExport}
          disabled={reviewed.length === 0 || isExporting}
          className="flex items-center gap-1 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-40"
        >
          {isExporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          Download zip
        </button>
      </div>
      {error && (
        <div className="basis-full rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
