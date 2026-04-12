import { useState } from 'react';
import { clsx } from 'clsx';
import { Search, Shield } from 'lucide-react';
import MetricsCards from './MetricsCards';
import PerLabelTable from './PerLabelTable';
import ConfusionMatrix from './ConfusionMatrix';
import RedactionDashboard from './RedactionDashboard';
import type { EvalRunDetail, LabelMetricsDetail, MatchMetrics, RedactionMetrics } from '../../api/types';

interface EvalDashboardProps {
  run: EvalRunDetail;
}

type EvalTab = 'detection' | 'redaction';

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
  const hasRedaction = !!metrics.has_redaction && !!metrics.redaction;
  const redaction = metrics.redaction as RedactionMetrics | undefined;

  const [activeTab, setActiveTab] = useState<EvalTab>(hasRedaction ? 'redaction' : 'detection');

  return (
    <div className="flex flex-col gap-4">
      {/* Run metadata */}
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

      {/* Tab toggle — only show when redaction metrics exist */}
      {hasRedaction && (
        <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden w-fit">
          <button
            onClick={() => setActiveTab('detection')}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors',
              activeTab === 'detection'
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-50',
            )}
          >
            <Search size={14} />
            Detection
          </button>
          <button
            onClick={() => setActiveTab('redaction')}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors',
              activeTab === 'redaction'
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-50',
            )}
          >
            <Shield size={14} />
            Redaction
          </button>
        </div>
      )}

      {/* Detection tab */}
      {activeTab === 'detection' && (
        <>
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
        </>
      )}

      {/* Redaction tab */}
      {activeTab === 'redaction' && redaction && (
        <RedactionDashboard redaction={redaction} />
      )}
    </div>
  );
}
