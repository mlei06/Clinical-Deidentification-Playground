import { Link } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import { splitLabelForDisplay, UNSPLIT_BUCKET } from './splitLabels';

export interface SplitSummaryProps {
  datasetName: string;
  /** Ordered counts from the manifest (e.g. train → … → (none)) */
  splitDocumentCounts: Record<string, number>;
}

export default function SplitSummary({ datasetName, splitDocumentCounts }: SplitSummaryProps) {
  const entries = Object.entries(splitDocumentCounts);
  const total = entries.reduce((s, [, c]) => s + c, 0);
  if (entries.length === 0) {
    return <p className="text-sm text-gray-500">No split data for this dataset.</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">Data splits</h4>
        <p className="mt-0.5 text-xs text-gray-500">
          From <code className="rounded bg-white px-0.5">metadata.split</code> on each document.{' '}
          {entries.some(([k]) => k === UNSPLIT_BUCKET) && (
            <span>“{splitLabelForDisplay(UNSPLIT_BUCKET)}” = missing or invalid split field.</span>
          )}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[24rem] text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              <th className="px-3 py-2">Split</th>
              <th className="px-3 py-2">Documents</th>
              <th className="px-3 py-2">Share</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {entries.map(([key, count]) => {
              const pct = total > 0 ? (count / total) * 100 : 0;
              return (
                <tr key={key} className="text-gray-700">
                  <td className="px-3 py-2 font-medium">{splitLabelForDisplay(key)}</td>
                  <td className="px-3 py-2 font-mono text-xs tabular-nums">{count.toLocaleString()}</td>
                  <td className="px-3 py-2 text-gray-600 tabular-nums">{pct.toFixed(1)}%</td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/evaluate?dataset=${encodeURIComponent(datasetName)}&splits=${encodeURIComponent(key)}`}
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                      title="Open Evaluate with this split"
                    >
                      <FlaskConical size={12} />
                      Evaluate
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
