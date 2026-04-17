import type { PHISpanResponse } from '../../api/types';

const HIGH_RISK = new Set(['SSN', 'MRN', 'NAME', 'PATIENT', 'ID', 'DATE']);

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export default function InferenceStatsTab({ spans }: { spans: PHISpanResponse[] }) {
  const withConf = spans.filter((s) => s.confidence != null);
  const confidences = withConf.map((s) => s.confidence as number);
  const avgConf = mean(confidences);
  const highRisk = spans.filter((s) => HIGH_RISK.has(s.label.toUpperCase())).length;
  const byLabel = [...new Set(spans.map((s) => s.label))].sort();

  return (
    <div className="flex flex-col gap-3 text-xs text-gray-700">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-gray-200 bg-white p-2">
          <div className="text-[10px] font-medium uppercase text-gray-400">Spans</div>
          <div className="text-lg font-semibold tabular-nums text-gray-900">{spans.length}</div>
        </div>
        <div className="rounded border border-gray-200 bg-white p-2">
          <div className="text-[10px] font-medium uppercase text-gray-400">High-risk labels</div>
          <div className="text-lg font-semibold tabular-nums text-amber-800">{highRisk}</div>
          <div className="text-[10px] text-gray-400">SSN, MRN, NAME, …</div>
        </div>
      </div>
      <div className="rounded border border-gray-200 bg-white p-2">
        <div className="text-[10px] font-medium uppercase text-gray-400">Mean confidence</div>
        <div className="text-lg font-semibold tabular-nums text-gray-900">
          {withConf.length === 0
            ? '—'
            : `${(avgConf * 100).toFixed(1)}%`}
        </div>
        <div className="text-[10px] text-gray-400">
          {withConf.length} of {spans.length} spans report a score
        </div>
      </div>
      <div>
        <div className="mb-1 text-[10px] font-medium uppercase text-gray-400">Labels present</div>
        <div className="flex flex-wrap gap-1">
          {byLabel.length === 0 ? (
            <span className="text-gray-400">None</span>
          ) : (
            byLabel.map((l) => (
              <span key={l} className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px]">
                {l}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
