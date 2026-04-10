import MetricsCards from './MetricsCards';
import PerLabelTable from './PerLabelTable';
import ConfusionMatrix from './ConfusionMatrix';
import type { EvalRunDetail, LabelMetricsDetail, MatchMetrics } from '../../api/types';

interface EvalDashboardProps {
  run: EvalRunDetail;
}

export default function EvalDashboard({ run }: EvalDashboardProps) {
  const metrics = run.metrics ?? {};
  const overall =
    metrics.overall && typeof metrics.overall === 'object'
      ? (metrics.overall as Record<string, MatchMetrics>)
      : {};
  const perLabel =
    metrics.per_label && typeof metrics.per_label === 'object'
      ? (metrics.per_label as Record<string, LabelMetricsDetail>)
      : ({} as Record<string, LabelMetricsDetail>);
  const riskWeightedRecall =
    (typeof metrics.risk_weighted_recall === 'number'
      ? metrics.risk_weighted_recall
      : run.risk_weighted_recall) ?? 0;
  const labelConfusion =
    metrics.label_confusion && typeof metrics.label_confusion === 'object'
      ? (metrics.label_confusion as Record<string, Record<string, number>>)
      : undefined;

  const hasOverallMetrics = Object.keys(overall).length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
        <span>
          Pipeline: <span className="font-medium text-gray-700">{run.pipeline_name}</span>
        </span>
        <span>
          Dataset: <span className="font-medium text-gray-700">{run.dataset_source}</span>
        </span>
        <span>
          Documents: <span className="font-medium text-gray-700">{run.document_count}</span>
        </span>
        <span>
          Created: <span className="font-medium text-gray-700">{new Date(run.created_at).toLocaleString()}</span>
        </span>
      </div>

      {!hasOverallMetrics && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No overall metrics in this run file (older or incomplete format). Summary scores may still
          appear in the list view.
        </div>
      )}

      <MetricsCards metrics={overall} riskWeightedRecall={riskWeightedRecall} />

      <PerLabelTable perLabel={perLabel} />

      {labelConfusion && Object.keys(labelConfusion).length > 0 && (
        <ConfusionMatrix confusion={labelConfusion} />
      )}
    </div>
  );
}
