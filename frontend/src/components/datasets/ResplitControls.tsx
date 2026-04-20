interface ResplitControlsProps {
  resplitEnabled: boolean;
  onResplitEnabledChange: (v: boolean) => void;
  /** Left boundary 0–100 (exclusive of train | valid split). */
  boundary1Pct: number;
  /** Right boundary 0–100 (valid | test). Must be > boundary1Pct. */
  boundary2Pct: number;
  onBoundary1Change: (pct: number) => void;
  onBoundary2Change: (pct: number) => void;
  /** Documents driving split count hints (post–sizing/boost projection). */
  sourceDocCount: number;
  ignoreExistingSplits: boolean;
  onIgnoreExistingSplitsChange: (v: boolean) => void;
}

/**
 * Data partitioning: optional train/valid/test re-split with a dual-boundary bar,
 * plus “ignore existing splits” when not re-splitting (merge metadata).
 */
export default function ResplitControls({
  resplitEnabled,
  onResplitEnabledChange,
  boundary1Pct,
  boundary2Pct,
  onBoundary1Change,
  onBoundary2Change,
  sourceDocCount,
  ignoreExistingSplits,
  onIgnoreExistingSplitsChange,
}: ResplitControlsProps) {
  const trainPct = boundary1Pct;
  const validPct = Math.max(0, boundary2Pct - boundary1Pct);
  const testPct = Math.max(0, 100 - boundary2Pct);

  const nTrain = Math.round((sourceDocCount * trainPct) / 100);
  const nValid = Math.round((sourceDocCount * validPct) / 100);
  const nTest = Math.max(0, sourceDocCount - nTrain - nValid);

  const clampB2 = (nextB1: number, b2: number) => Math.max(nextB1 + 0.5, Math.min(99.5, b2));
  const clampB1 = (b1: number, nextB2: number) => Math.max(0.5, Math.min(nextB2 - 0.5, b1));

  return (
    <div className="flex flex-col gap-3 rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <div>
        <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
          Partitioning
        </h5>
        <p className="mt-0.5 text-xs text-gray-500">Assign documents to train, validation, and test.</p>
      </div>

      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-gray-100 bg-gray-50/80 p-3">
        <input
          type="checkbox"
          checked={resplitEnabled}
          onChange={(e) => onResplitEnabledChange(e.target.checked)}
          className="mt-0.5 rounded border-gray-300"
        />
        <span>
          <span className="text-sm font-medium text-gray-800">Re-split corpus</span>
          <span className="mt-0.5 block text-xs text-gray-500">
            Replace existing <code className="rounded bg-gray-100 px-0.5">split</code> metadata with new
            train / valid / test fractions (random, seed-fixed).
          </span>
        </span>
      </label>

      {resplitEnabled && (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium text-gray-600">Split mix (sums to 100%)</p>
          {/* Segmented bar */}
          <div className="flex h-9 w-full overflow-hidden rounded-md border border-gray-200 shadow-inner">
            <div
              className="flex items-center justify-center bg-sky-100/90 text-[10px] font-medium text-sky-900"
              style={{ width: `${trainPct}%` }}
              title="Train"
            >
              {trainPct >= 8 ? `${trainPct.toFixed(0)}%` : ''}
            </div>
            <div
              className="flex items-center justify-center bg-amber-100/90 text-[10px] font-medium text-amber-900"
              style={{ width: `${validPct}%` }}
              title="Valid"
            >
              {validPct >= 8 ? `${validPct.toFixed(0)}%` : ''}
            </div>
            <div
              className="flex items-center justify-center bg-emerald-100/90 text-[10px] font-medium text-emerald-900"
              style={{ width: `${testPct}%`, minWidth: 0 }}
              title="Test"
            >
              {testPct >= 8 ? `${testPct.toFixed(0)}%` : ''}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 flex justify-between text-xs text-gray-500">
                <span>Train boundary</span>
                <span className="font-mono">{trainPct.toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={Math.max(0.5, boundary2Pct - 0.5)}
                step={0.5}
                value={Math.min(boundary1Pct, boundary2Pct - 0.5)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onBoundary1Change(clampB1(v, boundary2Pct));
                }}
                className="w-full accent-sky-700"
              />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-gray-500">
                <span>Valid | Test boundary</span>
                <span className="font-mono">{boundary2Pct.toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min={boundary1Pct + 0.5}
                max={99.5}
                step={0.5}
                value={Math.max(boundary1Pct + 0.5, Math.min(99.5, boundary2Pct))}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onBoundary2Change(clampB2(boundary1Pct, v));
                }}
                className="w-full accent-amber-700"
              />
            </div>
          </div>

          <p className="text-xs text-gray-600">
            Approx. documents: <span className="font-medium text-gray-800">train {nTrain.toLocaleString()}</span>
            {' · '}
            <span className="font-medium text-gray-800">valid {nValid.toLocaleString()}</span>
            {' · '}
            <span className="font-medium text-gray-800">test {nTest.toLocaleString()}</span> (rounded; server uses
            largest-remainder allocation).
          </p>
        </div>
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
            <span className="text-sm font-medium text-gray-800">Ignore existing splits</span>
            <span className="mt-0.5 block text-xs text-gray-600">
              Remove <code className="rounded bg-white/80 px-0.5">split</code> from every document so the corpus is
              treated as one pool (e.g. all &quot;train&quot;). Use this when you are not re-splitting.
            </span>
          </span>
        </label>
      )}
    </div>
  );
}

/** Re-split: normalized train / valid / test weights. */
export function buildResplitPayload(
  enabled: boolean,
  boundary1Pct: number,
  boundary2Pct: number,
): Record<string, number> | undefined {
  if (!enabled) return undefined;
  const train = boundary1Pct / 100;
  const valid = (boundary2Pct - boundary1Pct) / 100;
  const test = (100 - boundary2Pct) / 100;
  return { train, valid, test };
}
