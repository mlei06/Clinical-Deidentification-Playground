import { Clock, Trash2 } from 'lucide-react';
import { useDatasets, useDeleteDataset } from '../../hooks/useDatasets';
import LabelBadge from '../shared/LabelBadge';
import type { DatasetSummary } from '../../api/types';

interface DatasetListProps {
  onSelect: (name: string) => void;
  selectedName: string | null;
}

export default function DatasetList({ onSelect, selectedName }: DatasetListProps) {
  const { data: datasets, isLoading } = useDatasets();
  const deleteMutation = useDeleteDataset();

  if (isLoading) {
    return <div className="text-sm text-gray-400">Loading datasets...</div>;
  }

  if (!datasets?.length) {
    return <div className="text-sm text-gray-400">No datasets registered yet</div>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200 bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Name</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Docs</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Spans</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Labels</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Date</th>
            <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {datasets.map((d: DatasetSummary) => (
            <tr
              key={d.name}
              onClick={() => onSelect(d.name)}
              className={`cursor-pointer hover:bg-gray-50 ${selectedName === d.name ? 'bg-blue-50' : ''}`}
            >
              <td className="px-3 py-2">
                <div className="font-medium text-gray-700">{d.name}</div>
                {d.description && (
                  <div className="text-xs text-gray-400 truncate max-w-48">{d.description}</div>
                )}
              </td>
              <td className="px-3 py-2 text-gray-500">{d.document_count}</td>
              <td className="px-3 py-2 text-gray-500">{d.total_spans}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {d.labels.slice(0, 4).map((l) => (
                    <LabelBadge key={l} label={l} />
                  ))}
                  {d.labels.length > 4 && (
                    <span className="text-[10px] text-gray-400">+{d.labels.length - 4}</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <Clock size={11} />
                  {d.created_at ? new Date(d.created_at).toLocaleDateString() : '—'}
                </span>
              </td>
              <td className="px-3 py-1.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete dataset "${d.name}"?`)) {
                      deleteMutation.mutate(d.name);
                    }
                  }}
                  className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
