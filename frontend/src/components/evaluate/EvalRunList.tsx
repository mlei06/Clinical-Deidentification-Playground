import { Clock } from 'lucide-react';
import { useEvalRuns } from '../../hooks/useEvalRuns';
import type { EvalRunSummary } from '../../api/types';

interface EvalRunListProps {
  onSelect: (id: string) => void;
  selectedId: string | null;
}

export default function EvalRunList({ onSelect, selectedId }: EvalRunListProps) {
  const { data: runs, isLoading } = useEvalRuns();

  if (isLoading) {
    return <div className="text-sm text-gray-400">Loading runs...</div>;
  }

  if (!runs?.length) {
    return <div className="text-sm text-gray-400">No evaluation runs yet</div>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200 bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Pipeline</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Dataset</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Docs</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Strict F1</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Risk Recall</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {runs.map((r: EvalRunSummary) => (
            <tr
              key={r.id}
              onClick={() => onSelect(r.id)}
              className={`cursor-pointer hover:bg-gray-50 ${selectedId === r.id ? 'bg-blue-50' : ''}`}
            >
              <td className="px-3 py-2 font-medium text-gray-700">{r.pipeline_name}</td>
              <td className="px-3 py-2 text-gray-500 truncate max-w-48">{r.dataset_source}</td>
              <td className="px-3 py-2 text-gray-500">{r.document_count}</td>
              <td className="px-3 py-2 font-medium text-gray-900">{(r.strict_f1 * 100).toFixed(1)}%</td>
              <td className="px-3 py-2 text-gray-600">{(r.risk_weighted_recall * 100).toFixed(1)}%</td>
              <td className="px-3 py-2 text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <Clock size={11} />
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
