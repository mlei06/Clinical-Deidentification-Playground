import { useState } from 'react';
import { Download, Loader2, Package } from 'lucide-react';
import JSZip from 'jszip';
import { downloadBlob } from '../../lib/download';
import { redactDocument } from '../../api/production';
import {
  useProductionStore,
  type Dataset,
  type DatasetFile,
  type ExportOutputType,
} from './store';

interface DatasetExportBarProps {
  dataset: Dataset;
  reviewer: string;
}

interface JsonlLine {
  schema_version: 1;
  output_type: ExportOutputType;
  id: string;
  source_label: string;
  text: string;
  spans: Array<{
    start: number;
    end: number;
    label: string;
    confidence?: number | null;
    source?: string | null;
  }>;
  resolved: boolean;
  metadata?: Record<string, unknown>;
}

function safeStem(name: string): string {
  return name.replace(/[\\/]/g, '_').replace(/\s+/g, '_').slice(0, 120) || 'dataset';
}

async function buildLine(
  file: DatasetFile,
  dataset: Dataset,
  reviewer: string,
  exportedAt: string,
): Promise<JsonlLine> {
  const base: Omit<JsonlLine, 'text' | 'spans'> = {
    schema_version: 1,
    output_type: dataset.exportOutputType,
    id: file.id,
    source_label: file.sourceLabel,
    resolved: file.resolved,
    metadata: {
      dataset_name: dataset.name,
      exported_at: exportedAt,
      reviewer: reviewer || null,
      note: file.note ?? null,
      last_detection_target: file.lastDetectionTarget ?? null,
    },
  };

  if (dataset.exportOutputType === 'annotated') {
    return {
      ...base,
      text: file.originalText,
      spans: file.annotations.map((s) => ({
        start: s.start,
        end: s.end,
        label: s.label,
        confidence: s.confidence ?? null,
        source: s.source ?? null,
      })),
    };
  }

  if (dataset.exportOutputType === 'redacted') {
    const res = await redactDocument(
      {
        text: file.originalText,
        spans: file.annotations.map((s) => ({
          start: s.start,
          end: s.end,
          label: s.label,
        })),
        output_mode: 'redacted',
      },
      reviewer || 'production-ui',
    );
    return {
      ...base,
      text: res.output_text,
      spans: [],
    };
  }

  // surrogate_annotated — emit the surrogate text and aligned spans captured by
  // useBatchDetect. Fall back to on-demand /process/redact for files detected
  // before surrogate support landed (those have no cached surrogate).
  let surrogateText = file.surrogateText ?? null;
  let surrogateSpans = file.annotationsOnSurrogate ?? null;
  if (!surrogateText || !surrogateSpans) {
    const res = await redactDocument(
      {
        text: file.originalText,
        spans: file.annotations.map((s) => ({
          start: s.start,
          end: s.end,
          label: s.label,
        })),
        output_mode: 'surrogate',
      },
      reviewer || 'production-ui',
    );
    surrogateText = res.output_text;
    // Fallback: no aligned spans available; leave empty.
    surrogateSpans = null;
  }
  return {
    ...base,
    text: surrogateText,
    spans:
      surrogateSpans?.map((s) => ({
        start: s.start,
        end: s.end,
        label: s.label,
        confidence: s.confidence ?? null,
        source: s.source ?? null,
      })) ?? [],
    metadata: {
      ...base.metadata,
      surrogate_alignment: surrogateSpans ? 'aligned' : 'unavailable',
      original_text: file.originalText,
      original_spans: file.annotations.map((s) => ({
        start: s.start,
        end: s.end,
        label: s.label,
      })),
    },
  };
}

export default function DatasetExportBar({ dataset, reviewer }: DatasetExportBarProps) {
  const lastScope = useProductionStore((s) => s.lastExportScope);
  const setLastScope = useProductionStore((s) => s.setLastExportScope);

  const [scope, setScope] = useState<'all' | 'resolved'>(lastScope);
  const [asZip, setAsZip] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<string | null>(null);

  const resolvedCount = dataset.files.filter((f) => f.resolved).length;
  const chosen = scope === 'resolved'
    ? dataset.files.filter((f) => f.resolved)
    : dataset.files;

  const setScopeAndRemember = (s: 'all' | 'resolved') => {
    setScope(s);
    setLastScope(s);
  };

  const handleExport = async () => {
    if (chosen.length === 0) {
      setError(scope === 'resolved' ? 'No resolved files to export.' : 'Dataset is empty.');
      return;
    }
    setError(null);
    setIsExporting(true);
    const exportedAt = new Date().toISOString();
    try {
      const lines: string[] = [];
      for (const f of chosen) {
        const line = await buildLine(f, dataset, reviewer, exportedAt);
        lines.push(JSON.stringify(line));
      }
      const jsonl = lines.join('\n') + '\n';
      const stamp = exportedAt.slice(0, 10);
      const stem = safeStem(dataset.name);

      if (asZip) {
        const zip = new JSZip();
        zip.file('corpus.jsonl', jsonl);
        zip.file(
          'manifest.json',
          JSON.stringify(
            {
              schema_version: 1,
              dataset_name: dataset.name,
              dataset_id: dataset.id,
              export_output_type: dataset.exportOutputType,
              scope,
              line_count: lines.length,
              reviewer: reviewer || null,
              exported_at: exportedAt,
            },
            null,
            2,
          ),
        );
        const blob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(`${stem}_${stamp}.zip`, blob, 'application/zip');
      } else {
        downloadBlob(
          `${stem}_${stamp}.jsonl`,
          new Blob([jsonl], { type: 'application/jsonl' }),
          'application/jsonl',
        );
      }
      setLastSummary(
        `${lines.length} line(s) · ${dataset.exportOutputType} · ${scope}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'export failed');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 bg-white px-4 py-2">
      <span className="text-xs font-medium text-gray-600">Export</span>
      <span className="text-[11px] text-gray-400">
        {dataset.files.length} total · {resolvedCount} resolved ·{' '}
        <code className="rounded bg-gray-100 px-1">{dataset.exportOutputType}</code>
      </span>
      <fieldset className="flex items-center gap-2 text-[11px] text-gray-600">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="export-scope"
            checked={scope === 'all'}
            onChange={() => setScopeAndRemember('all')}
          />
          All files
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="export-scope"
            checked={scope === 'resolved'}
            onChange={() => setScopeAndRemember('resolved')}
          />
          Resolved only
        </label>
      </fieldset>
      <label className="flex items-center gap-1 text-[11px] text-gray-600">
        <input
          type="checkbox"
          checked={asZip}
          onChange={(e) => setAsZip(e.target.checked)}
        />
        Wrap in .zip with manifest
      </label>
      <div className="ml-auto flex items-center gap-2">
        {lastSummary && <span className="text-[11px] text-gray-500">{lastSummary}</span>}
        <button
          type="button"
          onClick={handleExport}
          disabled={chosen.length === 0 || isExporting}
          className="flex items-center gap-1 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-40"
        >
          {isExporting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : asZip ? (
            <Package size={12} />
          ) : (
            <Download size={12} />
          )}
          {asZip ? 'Download .zip' : 'Download .jsonl'}
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
