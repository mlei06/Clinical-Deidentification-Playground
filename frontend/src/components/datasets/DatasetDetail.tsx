import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Loader2, Download, FlaskConical } from 'lucide-react';
import { useDataset, useRefreshAnalytics, useExportDataset } from '../../hooks/useDatasets';
import AnalyticsDashboard from './AnalyticsDashboard';
import DocumentBrowser from './DocumentBrowser';
import type { TrainingExportFormat, ExportTrainingResponse } from '../../api/types';

interface DatasetDetailProps {
  name: string;
}

type Tab = 'analytics' | 'documents';

export default function DatasetDetail({ name }: DatasetDetailProps) {
  const { data: dataset, isLoading } = useDataset(name);
  const refreshMutation = useRefreshAnalytics();
  const exportMutation = useExportDataset(name);
  const [tab, setTab] = useState<Tab>('analytics');
  const [exportFormat, setExportFormat] = useState<TrainingExportFormat>('conll');
  const [exportResult, setExportResult] = useState<ExportTrainingResponse | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = () => {
    setExportError(null);
    setExportResult(null);
    exportMutation.mutate(
      { format: exportFormat },
      {
        onSuccess: (data) => setExportResult(data),
        onError: (err: unknown) =>
          setExportError(err instanceof Error ? err.message : 'Export failed'),
      },
    );
  };

  if (isLoading) {
    return <div className="text-sm text-gray-400">Loading dataset...</div>;
  }

  if (!dataset) {
    return <div className="text-sm text-gray-400">Dataset not found</div>;
  }

  const provenance = (dataset.metadata as Record<string, unknown>)?.provenance as
    | Record<string, unknown>
    | undefined;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{dataset.name}</h2>
          {dataset.description && (
            <p className="text-sm text-gray-500">{dataset.description}</p>
          )}
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-400">
            <span>Format: <strong className="text-gray-600">{dataset.format}</strong></span>
            <span>Path: <code className="text-gray-500">{dataset.data_path}</code></span>
          </div>
          {provenance && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">
                Provenance
              </summary>
              <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-2 text-xs text-gray-600">
                {JSON.stringify(provenance, null, 2)}
              </pre>
            </details>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/evaluate?dataset=${encodeURIComponent(name)}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            title="Open Evaluate with this dataset selected"
          >
            <FlaskConical size={13} />
            Evaluate
          </Link>
          <div className="flex items-center gap-1 rounded-md border border-gray-200 p-0.5">
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as TrainingExportFormat)}
              className="bg-transparent px-2 py-1 text-xs text-gray-700 focus:outline-none"
              title="Training export format"
            >
              <option value="conll">CoNLL</option>
              <option value="spacy">spaCy DocBin</option>
              <option value="huggingface">HuggingFace JSONL</option>
            </select>
            <button
              onClick={handleExport}
              disabled={exportMutation.isPending}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              title="Export dataset to training format"
            >
              {exportMutation.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Download size={13} />
              )}
              Export
            </button>
          </div>
          <button
            onClick={() => refreshMutation.mutate(name)}
            disabled={refreshMutation.isPending}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            title="Refresh analytics from disk"
          >
            {refreshMutation.isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            Refresh
          </button>
        </div>
      </div>

      {(exportResult || exportError) && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            exportError
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-green-200 bg-green-50 text-green-800'
          }`}
        >
          {exportError ? (
            <>Export failed: {exportError}</>
          ) : exportResult ? (
            <>
              Exported {exportResult.document_count} docs ({exportResult.total_spans} spans) as{' '}
              <strong>{exportResult.format}</strong> →{' '}
              <code className="text-gray-700">{exportResult.path}</code>
            </>
          ) : null}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(['analytics', 'documents'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t
                ? 'border-b-2 border-gray-900 text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'analytics' && <AnalyticsDashboard dataset={dataset} />}
      {tab === 'documents' && <DocumentBrowser datasetName={name} />}
    </div>
  );
}
