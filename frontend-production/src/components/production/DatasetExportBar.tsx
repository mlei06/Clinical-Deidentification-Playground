import { useEffect, useState } from 'react';
import { Download, Loader2, Package, UploadCloud } from 'lucide-react';
import JSZip from 'jszip';
import { ApiError } from '../../api/client';
import { uploadDataset } from '../../api/datasets';
import { getHealth } from '../../api/health';
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

async function buildJsonlString(
  files: DatasetFile[],
  dataset: Dataset,
  reviewer: string,
  exportedAt: string,
): Promise<string> {
  const lines: string[] = [];
  for (const f of files) {
    const line = await buildLine(f, dataset, reviewer, exportedAt);
    lines.push(JSON.stringify(line));
  }
  return lines.join('\n') + '\n';
}

function registerOnServerTitle(
  healthLoaded: boolean,
  scope: 'admin' | 'inference' | null | undefined,
  chosenCount: number,
): string {
  if (!healthLoaded) return 'Checking API key scope…';
  if (scope === 'inference') {
    return 'Register on the server requires an admin API key. The configured key is inference-only.';
  }
  if (scope !== 'admin') {
    return 'Set VITE_API_KEY to an admin API key, or download and register from the Playground Datasets tab.';
  }
  if (chosenCount === 0) {
    return 'No files in the current export scope to register.';
  }
  return 'Register this export on the Datasets API (uses production_v1 line format).';
}

export default function DatasetExportBar({ dataset, reviewer }: DatasetExportBarProps) {
  const lastScope = useProductionStore((s) => s.lastExportScope);
  const setLastScope = useProductionStore((s) => s.setLastExportScope);

  const [scope, setScope] = useState<'all' | 'resolved'>(lastScope);
  const [asZip, setAsZip] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<string | null>(null);
  const [apiKeyScope, setApiKeyScope] = useState<'admin' | 'inference' | null | undefined>(
    undefined,
  );
  const [healthLoaded, setHealthLoaded] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [regName, setRegName] = useState('');
  const [regDescription, setRegDescription] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((h) => {
        if (cancelled) return;
        setApiKeyScope(h.api_key_scope ?? null);
        setHealthLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setApiKeyScope(null);
        setHealthLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedCount = dataset.files.filter((f) => f.resolved).length;
  const chosen = scope === 'resolved'
    ? dataset.files.filter((f) => f.resolved)
    : dataset.files;

  const canRegisterOnServer = healthLoaded && apiKeyScope === 'admin' && chosen.length > 0;
  const registerTitle = registerOnServerTitle(healthLoaded, apiKeyScope, chosen.length);

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
      const jsonl = await buildJsonlString(chosen, dataset, reviewer, exportedAt);
      const lineCount = jsonl ? jsonl.trim().split('\n').filter(Boolean).length : 0;
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
              line_count: lineCount,
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
        `${lineCount} line(s) · ${dataset.exportOutputType} · ${scope}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const openRegisterModal = () => {
    if (!canRegisterOnServer) return;
    setRegError(null);
    setError(null);
    setRegName(safeStem(dataset.name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'dataset');
    setRegDescription(`Production export: ${dataset.name} (${dataset.exportOutputType})`);
    setRegisterOpen(true);
  };

  const handleRegisterOnServer = async () => {
    if (!regName.trim()) {
      setRegError('Dataset name is required.');
      return;
    }
    setRegError(null);
    setIsRegistering(true);
    const exportedAt = new Date().toISOString();
    try {
      const jsonl = await buildJsonlString(chosen, dataset, reviewer, exportedAt);
      const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
      const res = await uploadDataset({
        name: regName.trim(),
        file: blob,
        filename: `${safeStem(dataset.name)}.jsonl`,
        description: regDescription.trim() || undefined,
        lineFormat: 'production_v1',
      });
      setRegisterOpen(false);
      setLastSummary(
        `Registered on server: ${res.name} · ${res.document_count} document(s)`,
      );
    } catch (err) {
      if (err instanceof ApiError) {
        const d = err.detail;
        setRegError(typeof d === 'string' ? d : JSON.stringify(d));
      } else {
        setRegError(err instanceof Error ? err.message : 'register failed');
      }
    } finally {
      setIsRegistering(false);
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
          title={registerTitle}
          onClick={openRegisterModal}
          disabled={!canRegisterOnServer}
          className="flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <UploadCloud size={12} />
          Register on server
        </button>
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

      {registerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="register-dataset-title"
        >
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
            <h2 id="register-dataset-title" className="text-sm font-semibold text-gray-900">
              Register on server
            </h2>
            <p className="mt-1 text-[11px] text-gray-500">
              Creates a new dataset on the API from this export (line_format=production_v1). Requires
              an admin API key.
            </p>
            <div className="mt-3 space-y-2">
              <label className="block text-[11px] font-medium text-gray-600" htmlFor="reg-name">
                Dataset name
              </label>
              <input
                id="reg-name"
                type="text"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                autoFocus
              />
              <label className="block text-[11px] font-medium text-gray-600" htmlFor="reg-desc">
                Description
              </label>
              <input
                id="reg-desc"
                type="text"
                value={regDescription}
                onChange={(e) => setRegDescription(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            {regError && (
              <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">
                {regError}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRegisterOpen(false)}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700"
                disabled={isRegistering}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRegisterOnServer}
                disabled={isRegistering}
                className="inline-flex items-center gap-1 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {isRegistering ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
                Register
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
