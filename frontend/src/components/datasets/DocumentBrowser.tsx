import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { useDatasetPreview, useDocument, useUpdateDocument } from '../../hooks/useDatasets';
import LabelBadge from '../shared/LabelBadge';
import SpanHighlighter from '../shared/SpanHighlighter';
import type { DocumentPreview } from '../../api/types';
import { splitLabelForDisplay, UNSPLIT_BUCKET } from './splitLabels';

interface DocumentBrowserProps {
  datasetName: string;
  splitDocumentCounts: Record<string, number>;
}

const PAGE_SIZE = 15;

/**
 * @param selected null = all splits; else include only these bucket keys
 */
function computeFilterSplits(
  selected: string[] | null,
  allKeys: string[],
): string[] | null {
  if (selected == null) return null;
  if (allKeys.length > 0 && selected.length === allKeys.length) return null;
  return selected;
}

export default function DocumentBrowser({ datasetName, splitDocumentCounts }: DocumentBrowserProps) {
  const [offset, setOffset] = useState(0);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const splitKeys = useMemo(
    () => Object.keys(splitDocumentCounts),
    [splitDocumentCounts],
  );
  /** null = all */
  const [selectedSplits, setSelectedSplits] = useState<string[] | null>(null);
  const filterSplits = useMemo(
    () => computeFilterSplits(selectedSplits, splitKeys),
    [selectedSplits, splitKeys],
  );

  const { data: page, isLoading } = useDatasetPreview(
    datasetName,
    offset,
    PAGE_SIZE,
    filterSplits,
  );
  const { data: docDetail } = useDocument(datasetName, selectedDocId);
  const previews = page?.items;
  const totalFiltered = page?.total ?? 0;

  const toggleKey = (key: string) => {
    setOffset(0);
    setSelectedSplits((prev) => {
      if (splitKeys.length === 0) return null;
      if (prev == null) {
        const next = splitKeys.filter((k) => k !== key);
        return next.length === 0 ? splitKeys : next;
      }
      if (prev.includes(key)) {
        const next = prev.filter((k) => k !== key);
        return next.length === 0 ? null : next;
      }
      const next = [...prev, key];
      if (next.length === splitKeys.length) return null;
      return next;
    });
  };

  if (isLoading) {
    return <div className="text-sm text-gray-400">Loading documents...</div>;
  }

  if (!previews?.length && offset === 0 && !filterSplits) {
    return <div className="text-sm text-gray-400">No documents in dataset</div>;
  }

  const isKeyOn = (key: string) =>
    selectedSplits == null ? true : selectedSplits.includes(key);

  return (
    <div className="flex flex-col gap-4">
      {splitKeys.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs font-medium text-gray-500">Include document splits</span>
          <div className="flex flex-wrap items-center gap-2">
            {splitKeys.map((k) => (
              <label
                key={k}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-gray-200 bg-white px-2 py-1 text-xs"
              >
                <input
                  type="checkbox"
                  className="rounded border-gray-300"
                  checked={isKeyOn(k)}
                  onChange={() => toggleKey(k)}
                />
                {splitLabelForDisplay(k)}
              </label>
            ))}
            {selectedSplits != null && (
              <button
                type="button"
                className="text-xs text-blue-600 hover:underline"
                onClick={() => {
                  setOffset(0);
                  setSelectedSplits(null);
                }}
              >
                All splits
              </button>
            )}
          </div>
        </div>
      )}

      {!previews?.length && offset === 0 ? (
        <p className="text-sm text-amber-800">No documents match the split filter.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">ID</th>
              {splitKeys.length > 0 && (
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Split</th>
              )}
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
                {splitKeys.length > 0 && (
                  <td className="px-3 py-2 text-gray-500">
                    {d.split != null && d.split !== ''
                      ? splitLabelForDisplay(d.split)
                      : splitLabelForDisplay(UNSPLIT_BUCKET)}
                  </td>
                )}
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

        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-2">
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-30"
          >
            <ChevronLeft size={14} /> Previous
          </button>
          <span className="text-xs text-gray-400">
            {totalFiltered > 0
              ? `Showing ${offset + 1}–${offset + (previews?.length ?? 0)} of ${totalFiltered}`
              : `Showing ${offset + 1}–${offset + (previews?.length ?? 0)}`}
          </span>
          <button
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={!previews || offset + previews.length >= totalFiltered}
            className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-30"
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>
      )}

      {docDetail && (
        <DocumentDetailPanel
          datasetName={datasetName}
          docDetail={docDetail}
          onClose={() => setSelectedDocId(null)}
        />
      )}
    </div>
  );
}

interface DocumentDetailPanelProps {
  datasetName: string;
  docDetail: {
    document_id: string;
    text: string;
    metadata: Record<string, unknown>;
    spans: { start: number; end: number; label: string; confidence?: number | null; source?: string | null }[];
  };
  onClose: () => void;
}

function DocumentDetailPanel({ datasetName, docDetail, onClose }: DocumentDetailPanelProps) {
  const [editing, setEditing] = useState(false);
  const [draftLabels, setDraftLabels] = useState<string[]>(
    docDetail.spans.map((s) => s.label),
  );
  const update = useUpdateDocument(datasetName);

  useEffect(() => {
    setDraftLabels(docDetail.spans.map((s) => s.label));
    setEditing(false);
  }, [docDetail.document_id, docDetail.spans]);

  const dirty = draftLabels.some((label, i) => label !== docDetail.spans[i]?.label);

  const handleSave = () => {
    update.mutate(
      {
        docId: docDetail.document_id,
        body: {
          spans: docDetail.spans.map((s, i) => ({
            start: s.start,
            end: s.end,
            label: draftLabels[i] ?? s.label,
            confidence: s.confidence ?? null,
            source: s.source ?? null,
          })),
        },
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-700">
          Document: <span className="font-mono">{docDetail.document_id}</span>
        </h4>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setDraftLabels(docDetail.spans.map((s) => s.label));
                  setEditing(false);
                }}
                className="text-xs text-gray-500 hover:text-gray-800"
                disabled={update.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty || update.isPending}
                className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              >
                {update.isPending ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              disabled={docDetail.spans.length === 0}
              title={
                docDetail.spans.length === 0
                  ? 'No spans to edit'
                  : 'Edit span labels inline'
              }
            >
              Edit labels
            </button>
          )}
          <button
            onClick={onClose}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Close
          </button>
        </div>
      </div>
      <SpanHighlighter
        text={docDetail.text}
        spans={docDetail.spans.map((s, i) => ({
          start: s.start,
          end: s.end,
          label: editing ? draftLabels[i] ?? s.label : s.label,
          text: docDetail.text.slice(s.start, s.end),
          confidence: s.confidence ?? null,
          source: s.source ?? null,
        }))}
      />
      {editing && (
        <div className="mt-3 space-y-1 rounded border border-gray-100 bg-gray-50 p-2">
          <p className="text-[11px] uppercase tracking-wider text-gray-400">
            Per-span labels
          </p>
          {docDetail.spans.map((s, i) => (
            <div
              key={`${s.start}:${s.end}`}
              className="flex items-center gap-2 text-xs"
            >
              <span className="font-mono text-gray-500">
                [{s.start}:{s.end}]
              </span>
              <span className="truncate text-gray-700 max-w-xs">
                {docDetail.text.slice(s.start, s.end)}
              </span>
              <input
                value={draftLabels[i] ?? ''}
                onChange={(e) => {
                  const next = [...draftLabels];
                  next[i] = e.target.value;
                  setDraftLabels(next);
                }}
                className="ml-auto w-32 rounded border border-gray-300 px-2 py-0.5 font-mono text-xs"
              />
            </div>
          ))}
          {update.isError && (
            <p className="text-xs text-red-600">
              {(update.error as Error)?.message ?? 'Update failed.'}
            </p>
          )}
        </div>
      )}
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
  );
}
