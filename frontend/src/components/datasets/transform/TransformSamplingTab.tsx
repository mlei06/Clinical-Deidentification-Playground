import { Loader2, Telescope, Wand2 } from 'lucide-react';
import type { DatasetLabelFrequency, TransformPreviewResponse } from '../../../api/types';
import SearchableLabelSelect from '../SearchableLabelSelect';

const BOOST_COPY_PRESETS = [0, 1, 2, 5, 10] as const;

function parseTargetN(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = parseInt(t, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function samplingExecuteActionLabel(
  targetDocumentCount: string,
  documentsInScope: number,
): { primary: string; detail: string } {
  const n = parseTargetN(targetDocumentCount);
  if (n != null) {
    return {
      primary: `Sample to ${n.toLocaleString()} documents`,
      detail: 'Applies random resize and optional label boost with the current seed',
    };
  }
  const d = documentsInScope > 0 ? documentsInScope.toLocaleString() : '—';
  return {
    primary: `Run sampling (${d} document${documentsInScope === 1 ? '' : 's'} in selected splits)`,
    detail: 'No target size: keeps every document in scope, then optional boost',
  };
}

interface TransformSamplingTabProps {
  source: string;
  /** Documents matching header target splits (for presets and size hints; aligned with server preview). */
  workDocumentCount: number;
  schemaLoading: boolean;
  schemaLabels: DatasetLabelFrequency[];
  targetDocumentCount: string;
  onTargetDocumentCountChange: (v: string) => void;
  transformSeed: number;
  onTransformSeedChange: (n: number) => void;
  boostLabel: string;
  onBoostLabelChange: (v: string) => void;
  boostExtraCopies: number;
  onBoostExtraCopiesChange: (n: number) => void;
  boostVsKeepWarning: string | null;
  previewResult: TransformPreviewResponse | null;
  previewPending: boolean;
  previewServerConflicts: string[];
  inPlace: boolean;
  outputName: string;
  canSubmit: boolean;
  onExecute: () => void;
  onRefreshPreview: () => void;
  transformPending: boolean;
  previewError: Error | null;
  transformError: Error | null;
}

export default function TransformSamplingTab({
  source,
  workDocumentCount,
  schemaLoading,
  schemaLabels,
  targetDocumentCount,
  onTargetDocumentCountChange,
  transformSeed,
  onTransformSeedChange,
  boostLabel,
  onBoostLabelChange,
  boostExtraCopies,
  onBoostExtraCopiesChange,
  boostVsKeepWarning,
  previewResult,
  previewPending,
  previewServerConflicts,
  inPlace,
  outputName,
  canSubmit,
  onExecute,
  onRefreshPreview,
  transformPending,
  previewError,
  transformError,
}: TransformSamplingTabProps) {
  if (!source) {
    return (
      <p className="text-sm text-gray-500">Select a source dataset in the header to configure sampling.</p>
    );
  }

  const nTarget = parseTargetN(targetDocumentCount);
  const nScope = workDocumentCount;
  const showCompare = nTarget != null && nScope > 0;
  const deltaCaption =
    nTarget == null
      ? 'Leave empty to keep every document in the selected splits (no resize).'
      : nTarget < nScope
        ? 'Downsampling: random subset without replacement.'
        : nTarget > nScope
          ? 'Upsampling: documents drawn with replacement until the count is met.'
          : 'Target size matches the number of documents in the selected splits.';

  const { primary: executePrimary, detail: executeDetail } = samplingExecuteActionLabel(
    targetDocumentCount,
    nScope,
  );

  const setPreset = (n: number) => onTargetDocumentCountChange(String(Math.max(0, Math.round(n))));

  const quickPresets =
    nScope > 0
      ? [
          { label: '25%' as const, v: () => setPreset(nScope * 0.25) },
          { label: '50%' as const, v: () => setPreset(nScope * 0.5) },
          { label: '75%' as const, v: () => setPreset(nScope * 0.75) },
          { label: '100%' as const, v: () => setPreset(nScope) },
          { label: '1.5×' as const, v: () => setPreset(nScope * 1.5) },
          { label: '2×' as const, v: () => setPreset(nScope * 2) },
        ]
      : [];

  const canExecute =
    canSubmit && source && (inPlace || outputName.trim()) && !transformPending;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Choose <strong>target splits</strong> in the header, then set an optional <strong>target size</strong> and
        optional <strong>label boost</strong>. <strong>Quick targets</strong> are fractions of the documents in the
        selected splits. The random seed applies to resize, boost, and the transform run.
      </p>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[1fr,16.5rem]">
        <div className="min-w-0 space-y-4">
          {/* Top: 2 columns — target + seed | quick targets */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-md bg-slate-50 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor="sampling-target-n"
                    className="text-xs font-medium text-gray-700"
                  >
                    Target size
                  </label>
                  <input
                    id="sampling-target-n"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={targetDocumentCount}
                    onChange={(e) => onTargetDocumentCountChange(e.target.value)}
                    placeholder={nScope > 0 ? `e.g. ${Math.max(1, Math.floor(nScope / 2))}` : 'e.g. 1000'}
                    className="mt-0.5 w-full min-w-0 rounded border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-sm font-semibold tabular-nums text-gray-900 shadow-sm focus:border-slate-400 focus:ring-1 focus:ring-slate-300 focus:outline-none"
                  />
                </div>
                <div className="w-full min-w-0 sm:w-36 sm:flex-shrink-0">
                  <label
                    htmlFor="sampling-seed"
                    className="text-xs font-medium text-gray-700"
                  >
                    Random seed
                  </label>
                  <input
                    id="sampling-seed"
                    type="number"
                    value={transformSeed}
                    onChange={(e) => onTransformSeedChange(Number(e.target.value) || 0)}
                    className="mt-0.5 w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-sm tabular-nums text-gray-900 shadow-sm focus:border-slate-400 focus:ring-1 focus:ring-slate-300 focus:outline-none"
                  />
                </div>
              </div>
              {showCompare && nTarget != null && (
                <p className="mt-1.5 text-xs italic text-slate-600">
                  {nTarget < nScope
                    ? `Downsample by ${(nScope - nTarget).toLocaleString()} document${nScope - nTarget === 1 ? '' : 's'}.`
                    : nTarget > nScope
                      ? `Upsample by ${(nTarget - nScope).toLocaleString()} (replacement).`
                      : 'Target size matches documents in the selected splits.'}
                </p>
              )}
              <p className="mt-1 text-[11px] italic text-slate-500">{deltaCaption}</p>
            </div>

            <div className="rounded-md bg-slate-50 p-3">
              <p className="text-xs font-medium text-gray-700">Quick targets</p>
              {quickPresets.length > 0 ? (
                <div
                  className="mt-2 inline-flex max-w-full flex-wrap rounded-md border border-slate-200 bg-white p-0.5 shadow-sm"
                  role="group"
                  aria-label="Quick size presets"
                >
                  {quickPresets.map((item, i) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={item.v}
                      className={`px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 ${
                        i > 0 ? 'border-l border-slate-200' : ''
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-500">Set a source with documents to enable presets.</p>
              )}
            </div>
          </div>

          {boostVsKeepWarning && (
            <div className="rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-950">
              <p className="font-medium">Oversampling</p>
              <p>{boostVsKeepWarning}</p>
            </div>
          )}

          {/* Augmentation: horizontal density */}
          <div className="rounded-md bg-gray-50 p-3">
            <h3 className="text-xs font-semibold text-gray-800">Augment rare labels (optional)</h3>
            <p className="text-[11px] text-gray-500">Runs after resize; duplicates matching documents.</p>
            <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:items-end lg:gap-3">
              <div className="min-w-0 flex-1">
                <label className="text-xs font-medium text-gray-600" htmlFor="boost-label-select">
                  Label to boost
                </label>
                <SearchableLabelSelect
                  options={schemaLabels}
                  value={boostLabel}
                  onChange={onBoostLabelChange}
                  disabled={!source || schemaLoading}
                  placeholder="Search labels…"
                  id="boost-label-select"
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 lg:max-w-md">
                <span className="text-xs font-medium text-gray-600">Extra copies per match</span>
                <div className="inline-flex flex-wrap gap-0 rounded-md border border-slate-200 bg-white p-0.5 shadow-sm">
                  {BOOST_COPY_PRESETS.map((p, i) => (
                    <button
                      key={p}
                      type="button"
                      disabled={!boostLabel.trim()}
                      onClick={() => onBoostExtraCopiesChange(p)}
                      className={`px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                        i > 0 ? 'border-l border-slate-200' : ''
                      } ${
                        boostExtraCopies === p
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-800 hover:bg-slate-50'
                      }`}
                    >
                      {p === 0 ? 'Off' : `${p}×`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

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

          {/* Actions */}
          <div className="flex flex-col gap-3 border-t border-gray-200 pt-3 sm:flex-row sm:items-end sm:justify-between">
            <button
              type="button"
              onClick={onRefreshPreview}
              disabled={!source || previewPending}
              className="inline-flex w-fit items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-40"
            >
              {previewPending ? <Loader2 size={15} className="animate-spin" /> : <Telescope size={15} />}
              Refresh preview
            </button>
            <div className="flex flex-col items-stretch gap-1 sm:items-end">
              <p className="max-w-md text-right text-[11px] text-slate-500">{executeDetail}</p>
              <button
                type="button"
                onClick={onExecute}
                disabled={!canExecute}
                className="inline-flex items-center justify-center gap-2 self-end rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {transformPending ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                {executePrimary}
              </button>
              {(transformError || previewError) && (
                <p className="text-right text-xs text-red-600">
                  {(transformError || previewError)?.message}
                </p>
              )}
            </div>
          </div>
          {transformPending && (
            <div className="h-1 w-full max-w-md self-end overflow-hidden rounded-full bg-slate-200 sm:ml-auto">
              <div className="h-full w-full animate-pulse bg-slate-800" />
            </div>
          )}
        </div>

        {/* Metrics: sticky on wide screens */}
        <aside
          className="xl:sticky xl:top-2 xl:max-h-[min(80vh,32rem)] xl:overflow-y-auto"
          aria-label="Preview metrics"
        >
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white text-xs shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              Preview
            </div>
            {previewResult ? (
              <table
                className={`w-full border-collapse text-left transition-opacity ${
                  previewPending ? 'opacity-70' : 'opacity-100'
                }`}
              >
                <tbody>
                  <tr className="border-b border-slate-100">
                    <td className="px-2.5 py-1.5 text-slate-600">Source documents</td>
                    <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-900">
                      {previewResult.source_document_count.toLocaleString()} docs
                    </td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="px-2.5 py-1.5 text-slate-600">Spans (before resize)</td>
                    <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-900">
                      {previewResult.source_span_count.toLocaleString()}
                    </td>
                  </tr>
                  {(previewResult.untouched_document_count ?? 0) > 0 && (
                    <tr className="border-b border-slate-100">
                      <td className="px-2.5 py-1.5 text-slate-600">Untouched splits</td>
                      <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-slate-900">
                        {(previewResult.untouched_document_count ?? 0).toLocaleString()}
                      </td>
                    </tr>
                  )}
                  <tr className="border-b border-slate-100">
                    <td className="px-2.5 py-1.5 font-medium text-slate-800">Projected documents</td>
                    <td className="px-2.5 py-1.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                      {previewResult.projected_document_count.toLocaleString()}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-2.5 py-1.5 font-medium text-slate-800">Projected spans</td>
                    <td className="px-2.5 py-1.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                      {previewResult.projected_span_count.toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p className="px-2.5 py-4 text-center text-slate-500">
                {previewPending ? 'Updating…' : 'Adjust targets to preview.'}
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
