import { Loader2, Telescope, Wand2 } from 'lucide-react';
import type { TransformPreviewResponse } from '../../../api/types';

type Workstation = 'schema' | 'sampling' | 'partitioning';

interface TransformImpactPreviewProps {
  mode: Workstation;
  source: string;
  /** When true, destination is the source; output name is not required. */
  inPlace: boolean;
  outputName: string;
  canSubmit: boolean;
  onSubmit: () => void;
  onRefreshPreview: () => void;
  previewResult: TransformPreviewResponse | null;
  previewServerConflicts: string[];
  previewPending: boolean;
  transformPending: boolean;
  previewError: Error | null;
  transformError: Error | null;
  submitLabel?: string;
}

export default function TransformImpactPreview({
  mode,
  source,
  inPlace,
  outputName,
  canSubmit,
  onSubmit,
  onRefreshPreview,
  previewResult,
  previewServerConflicts,
  previewPending,
  transformPending,
  previewError,
  transformError,
  submitLabel = 'Execute',
}: TransformImpactPreviewProps) {
  return (
    <div className="grid grid-cols-1 gap-3 border-t border-gray-100 pt-4">
      {previewServerConflicts.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-medium">Preview warnings</p>
          <ul className="list-inside list-disc">
            {previewServerConflicts.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {previewResult && (
        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white text-xs">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-3 py-2 font-medium">Metric</th>
                <th className="px-3 py-2 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {mode === 'schema' && (
                <>
                  <tr className="border-b border-gray-100">
                    <td className="px-3 py-1.5">Spans dropped (filter)</td>
                    <td className="px-3 py-1.5 font-mono">
                      {previewResult.spans_dropped_by_filter.toLocaleString()}
                    </td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="px-3 py-1.5">Spans kept after filter</td>
                    <td className="px-3 py-1.5 font-mono">
                      {previewResult.spans_kept_after_filter.toLocaleString()}
                    </td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="px-3 py-1.5">Spans renamed (mapping)</td>
                    <td className="px-3 py-1.5 font-mono">
                      {previewResult.spans_renamed.toLocaleString()}
                    </td>
                  </tr>
                </>
              )}
              {(previewResult.untouched_document_count ?? 0) > 0 && (
                <tr className="border-b border-gray-100">
                  <td className="px-3 py-1.5">Untouched (outside target splits)</td>
                  <td className="px-3 py-1.5 font-mono">
                    {(previewResult.untouched_document_count ?? 0).toLocaleString()}
                  </td>
                </tr>
              )}
              <tr className="border-b border-gray-100">
                <td className="px-3 py-1.5">Projected documents (full output)</td>
                <td className="px-3 py-1.5 font-mono">
                  {previewResult.projected_document_count.toLocaleString()}
                </td>
              </tr>
              <tr>
                <td className="px-3 py-1.5">Projected spans</td>
                <td className="px-3 py-1.5 font-mono">
                  {previewResult.projected_span_count.toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
          {previewResult.split_document_counts &&
            Object.keys(previewResult.split_document_counts).length > 0 && (
              <p className="border-t border-gray-100 px-3 py-2 text-gray-600">
                Splits:{' '}
                {Object.entries(previewResult.split_document_counts)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ')}
              </p>
            )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onRefreshPreview}
            disabled={!source || previewPending}
            className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-40"
          >
            {previewPending ? <Loader2 size={15} className="animate-spin" /> : <Telescope size={15} />}
            Refresh preview
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={
              !source || (!inPlace && !outputName.trim()) || transformPending || !canSubmit
            }
            className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:opacity-40"
          >
            {transformPending ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
            {submitLabel}
          </button>
          {transformError && <span className="text-xs text-red-600">{(transformError as Error).message}</span>}
          {previewError && <span className="text-xs text-red-600">{(previewError as Error).message}</span>}
        </div>
        {transformPending && (
          <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-gray-200">
            <div className="h-full w-full animate-pulse bg-gray-800" />
          </div>
        )}
      </div>
    </div>
  );
}
