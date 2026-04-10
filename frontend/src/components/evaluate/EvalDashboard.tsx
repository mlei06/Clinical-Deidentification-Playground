import MetricsCards from './MetricsCards';
import PerLabelTable from './PerLabelTable';
import ConfusionMatrix from './ConfusionMatrix';
import type { EvalRunDetail } from '../../api/types';

interface EvalDashboardProps {
  run: EvalRunDetail;
}

export default function EvalDashboard({ run }: EvalDashboardProps) {
  const { metrics } = run;

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

      <MetricsCards
        metrics={metrics.overall}
        riskWeightedRecall={metrics.risk_weighted_recall}
      />

      <PerLabelTable perLabel={metrics.per_label} />

      {metrics.label_confusion && Object.keys(metrics.label_confusion).length > 0 && (
        <ConfusionMatrix confusion={metrics.label_confusion} />
      )}
    </div>
  );
}
