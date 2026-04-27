import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import ExportStep from './ExportStep';
import { useActiveDataset, useProductionStore } from './store';

export default function SettingsView() {
  const active = useActiveDataset();
  const reviewer = useProductionStore((s) => s.reviewer);

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50 p-8 text-sm text-gray-500">
        Pick a dataset from Library first.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-gray-50">
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-4 py-3">
        <h1 className="text-sm font-semibold text-gray-900">Export</h1>
        <span className="text-xs text-gray-400">{active.name}</span>
        <Link
          to={`/datasets/${active.id}/files`}
          className="ml-auto inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
        >
          <ArrowLeft size={12} />
          Back to Workspace
        </Link>
      </header>

      <div className="min-h-0 flex-1">
        <ExportStep dataset={active} reviewer={reviewer} />
      </div>
    </div>
  );
}
