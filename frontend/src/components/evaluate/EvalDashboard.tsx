import { useState } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { Search, Shield, Database } from 'lucide-react';
import MetricsCards from './MetricsCards';
import PerLabelTable from './PerLabelTable';
import ConfusionMatrix from './ConfusionMatrix';
import RedactionDashboard from './RedactionDashboard';
import EvalPerDocumentPanel from './EvalPerDocumentPanel';
import type {
  EvalPerDocumentItem,
  EvalRunDetail,
  LabelMetricsDetail,
  MatchMetrics,
  RedactionMetrics,
} from '../../api/types';

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
  const sample = metrics.sample;
  const perDocItems = Array.isArray(metrics.document_level)
    ? (metrics.document_level as EvalPerDocumentItem[])
    : undefined;
  const evalPredLabelRemap =
    metrics.eval_pred_label_remap && typeof metrics.eval_pred_label_remap === 'object'
      ? (metrics.eval_pred_label_remap as Record<string, string>)
      : undefined;

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
      {sample && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-indigo-100 bg-indigo-50/50 px-3 py-1.5 text-xs text-indigo-900">
          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
            Sampled
          </span>
          <span>
            {sample.sample_size} of {sample.sample_of_total} documents
          </span>
          <span className="text-indigo-700/80">·</span>
          <span>
            seed <code className="rounded bg-white/80 px-1 font-mono">{sample.sample_seed_used}</code>
          </span>
          {sample.saved_dataset_name && (
            <>
              <span className="text-indigo-700/80">·</span>
              <span className="text-indigo-800">saved as</span>
              <Link
                to="/datasets"
                className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-indigo-900 ring-1 ring-indigo-200 hover:bg-indigo-50"
              >
                <Database size={11} className="opacity-70" />
                {sample.saved_dataset_name}
              </Link>
            </>
          )}
        </div>
      )}
      {evalPredLabelRemap && Object.keys(evalPredLabelRemap).length > 0 && (
        <div className="flex flex-wrap items-start gap-2 rounded-md border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-950">
          <span className="font-semibold">Eval remap applied</span>
          {Object.entries(evalPredLabelRemap)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([source, target]) => (
              <code key={source} className="rounded bg-white/80 px-1 py-0.5 font-mono text-[11px]">
                {source} -&gt; {target}
              </code>
            ))}
        </div>
      )}

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
          {perDocItems && perDocItems.length > 0 && (
            <EvalPerDocumentPanel
              items={perDocItems}
              truncated={!!metrics.document_level_truncated}
              total={metrics.document_level_total ?? perDocItems.length}
              includesSpans={!!metrics.document_level_includes_spans}
            />
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
