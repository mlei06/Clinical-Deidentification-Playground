import { useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useDataset, useRefreshAnalytics } from '../../hooks/useDatasets';
import AnalyticsDashboard from './AnalyticsDashboard';
import DocumentBrowser from './DocumentBrowser';

interface DatasetDetailProps {
  name: string;
}

type Tab = 'analytics' | 'documents';

export default function DatasetDetail({ name }: DatasetDetailProps) {
  const { data: dataset, isLoading } = useDataset(name);
  const refreshMutation = useRefreshAnalytics();
  const [tab, setTab] = useState<Tab>('analytics');

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
