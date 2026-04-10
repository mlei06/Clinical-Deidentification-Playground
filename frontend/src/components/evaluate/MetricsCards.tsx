import type { MatchMetrics } from '../../api/types';

interface MetricsCardsProps {
  metrics: Record<string, MatchMetrics>;
  riskWeightedRecall: number;
}

function MetricCard({
  title,
  m,
}: {
  title: string;
  m: MatchMetrics;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        {title}
      </div>
      <div className="flex gap-4">
        <Stat label="Precision" value={m.precision} />
        <Stat label="Recall" value={m.recall} />
        <Stat label="F1" value={m.f1} highlight />
      </div>
      <div className="mt-2 flex gap-3 text-[10px] text-gray-400">
        <span>TP {m.tp}</span>
        <span>FP {m.fp}</span>
        <span>FN {m.fn}</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] text-gray-400">{label}</div>
      <div
        className={`text-lg font-semibold ${highlight ? 'text-gray-900' : 'text-gray-600'}`}
      >
        {(value * 100).toFixed(1)}%
      </div>
    </div>
  );
}

export default function MetricsCards({ metrics, riskWeightedRecall }: MetricsCardsProps) {
  const modes = ['strict', 'exact_boundary', 'partial_overlap', 'token_level'] as const;

  return (
    <div className="grid grid-cols-2 gap-3">
      {modes.map(
        (mode) =>
          metrics[mode] && (
            <MetricCard
              key={mode}
              title={mode.replace(/_/g, ' ')}
              m={metrics[mode]}
            />
          ),
      )}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
          Risk-Weighted Recall
        </div>
        <div className="text-2xl font-bold text-gray-900">
          {(riskWeightedRecall * 100).toFixed(1)}%
        </div>
      </div>
    </div>
  );
}
