import { useState } from 'react';
import { ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { useDatasetPreview, useDocument } from '../../hooks/useDatasets';
import LabelBadge from '../shared/LabelBadge';
import SpanHighlighter from '../shared/SpanHighlighter';
import type { DocumentPreview } from '../../api/types';

interface DocumentBrowserProps {
  datasetName: string;
}

const PAGE_SIZE = 15;

export default function DocumentBrowser({ datasetName }: DocumentBrowserProps) {
  const [offset, setOffset] = useState(0);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  const { data: previews, isLoading } = useDatasetPreview(datasetName, offset, PAGE_SIZE);
  const { data: docDetail } = useDocument(datasetName, selectedDocId);

  if (isLoading) {
    return <div className="text-sm text-gray-400">Loading documents...</div>;
  }

  if (!previews?.length && offset === 0) {
    return <div className="text-sm text-gray-400">No documents in dataset</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Document list */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">ID</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Preview</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Spans</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Labels</th>
              <th className="px-3 py-2 text-[10px]"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {previews?.map((d: DocumentPreview) => (
              <tr
                key={d.document_id}
                className={`hover:bg-gray-50 ${selectedDocId === d.document_id ? 'bg-blue-50' : ''}`}
              >
                <td className="px-3 py-2 font-mono text-xs text-gray-600">{d.document_id}</td>
                <td className="px-3 py-2 text-gray-500 truncate max-w-sm">{d.text_preview}</td>
                <td className="px-3 py-2 text-gray-500">{d.span_count}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {d.labels.slice(0, 3).map((l) => (
                      <LabelBadge key={l} label={l} />
                    ))}
                    {d.labels.length > 3 && (
                      <span className="text-[10px] text-gray-400">+{d.labels.length - 3}</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-1.5">
                  <button
                    onClick={() =>
                      setSelectedDocId(selectedDocId === d.document_id ? null : d.document_id)
                    }
                    className="rounded p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-600"
                    title="View document"
                  >
                    <Eye size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-2">
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-30"
          >
            <ChevronLeft size={14} /> Previous
          </button>
          <span className="text-xs text-gray-400">
            Showing {offset + 1}–{offset + (previews?.length ?? 0)}
          </span>
          <button
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={!previews || previews.length < PAGE_SIZE}
            className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-30"
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Document detail */}
      {docDetail && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-700">
              Document: <span className="font-mono">{docDetail.document_id}</span>
            </h4>
            <button
              onClick={() => setSelectedDocId(null)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Close
            </button>
          </div>
          <SpanHighlighter
            text={docDetail.text}
            spans={docDetail.spans.map((s) => ({
              start: s.start,
              end: s.end,
              label: s.label,
              text: docDetail.text.slice(s.start, s.end),
              confidence: s.confidence ?? null,
              source: s.source ?? null,
            }))}
          />
          {Object.keys(docDetail.metadata).length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">
                Metadata
              </summary>
              <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-2 text-xs text-gray-600">
                {JSON.stringify(docDetail.metadata, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
