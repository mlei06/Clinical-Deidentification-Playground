import DynamicResplitEditor, { type SplitPartRow } from './DynamicResplitEditor';

interface TransformPartitioningTabProps {
  source: string;
  resplitEnabled: boolean;
  onResplitEnabledChange: (on: boolean) => void;
  partRows: SplitPartRow[];
  onPartRowsChange: (rows: SplitPartRow[]) => void;
  /** Documents in scope (targeted pool) for count hints. */
  partitioningDocHint: number;
  ignoreExistingSplits: boolean;
  onIgnoreExistingSplitsChange: (v: boolean) => void;
  flattenTargetSplits: boolean;
  onFlattenTargetSplitsChange: (v: boolean) => void;
  resplitShuffle: boolean;
  onResplitShuffleChange: (v: boolean) => void;
  transformSeed: number;
  onTransformSeedChange: (v: number) => void;
}

export default function TransformPartitioningTab({
  source,
  resplitEnabled,
  onResplitEnabledChange,
  partRows,
  onPartRowsChange,
  partitioningDocHint,
  ignoreExistingSplits,
  onIgnoreExistingSplitsChange,
  flattenTargetSplits,
  onFlattenTargetSplitsChange,
  resplitShuffle,
  onResplitShuffleChange,
  transformSeed,
  onTransformSeedChange,
}: TransformPartitioningTabProps) {
  if (!source) {
    return (
      <p className="text-sm text-gray-500">Select a source dataset in the header to configure partitioning.</p>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-xs text-gray-500">
        <strong>Target splits</strong> in the header define which documents are re-partitioned or have split metadata
        cleared. The rest of the corpus is unchanged in the output.
      </p>

      <div className="flex flex-col gap-3 rounded-md border border-gray-200 bg-white p-4 shadow-sm">
        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Split assignment</h5>
          <p className="mt-0.5 text-xs text-gray-500">Named splits and relative weights (normalized server-side).</p>
        </div>

        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-gray-100 bg-gray-50/80 p-3">
          <input
            type="checkbox"
            checked={resplitEnabled}
            onChange={(e) => {
              onResplitEnabledChange(e.target.checked);
              if (e.target.checked) onIgnoreExistingSplitsChange(false);
            }}
            className="mt-0.5 rounded border-gray-300"
          />
          <span>
            <span className="text-sm font-medium text-gray-800">Re-partition</span>
            <span className="mt-0.5 block text-xs text-gray-500">Overwrite split metadata using the mix below.</span>
          </span>
        </label>

        {resplitEnabled && (
          <>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={flattenTargetSplits}
                onChange={(e) => onFlattenTargetSplitsChange(e.target.checked)}
                className="mt-0.5 rounded border-gray-300"
              />
              <span>
                <span className="font-medium text-gray-800">Flatten first</span>
                <span className="mt-0.5 block text-xs text-gray-500">
                  Remove existing <code className="rounded bg-gray-100 px-0.5">split</code> on targeted documents
                  before assigning new buckets (treats them as one pool).
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={resplitShuffle}
                onChange={(e) => onResplitShuffleChange(e.target.checked)}
                className="mt-0.5 rounded border-gray-300"
              />
              <span>
                <span className="font-medium text-gray-800">Shuffle before assign</span>
                <span className="mt-0.5 block text-xs text-gray-500">
                  Random order (seeded). Off = stable by document id, then proportional assignment.
                </span>
              </span>
            </label>
            <div className="grid gap-1 sm:max-w-xs">
              <label className="text-xs font-medium text-gray-600">Random seed</label>
              <input
                type="number"
                value={transformSeed}
                onChange={(e) => onTransformSeedChange(Number(e.target.value) || 0)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <DynamicResplitEditor
              rows={partRows}
              onRowsChange={onPartRowsChange}
              sourceDocCount={Math.max(0, partitioningDocHint)}
            />
          </>
        )}

        {!resplitEnabled && (
          <label
            className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 ${
              ignoreExistingSplits
                ? 'border-amber-300 bg-amber-50/90'
                : 'border-gray-100 bg-gray-50/80'
            }`}
          >
            <input
              type="checkbox"
              checked={ignoreExistingSplits}
              onChange={(e) => onIgnoreExistingSplitsChange(e.target.checked)}
              className="mt-0.5 rounded border-gray-300"
            />
            <span>
              <span className="text-sm font-medium text-gray-800">Clear split metadata</span>
              <span className="mt-0.5 block text-xs text-gray-600">
                Remove <code className="rounded bg-white/80 px-0.5">split</code> from targeted documents.
              </span>
            </span>
          </label>
        )}
      </div>
    </div>
  );
}
