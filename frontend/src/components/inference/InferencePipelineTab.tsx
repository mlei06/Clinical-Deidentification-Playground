import TraceTimeline from './TraceTimeline';
import { usePipeline } from '../../hooks/usePipelines';
import type { EntitySpanResponse, TraceFrame } from '../../api/types';

const HIGH_RISK = new Set([
  'SSN',
  'MRN',
  'NAME',
  'FIRST_NAME',
  'LAST_NAME',
  'PATIENT',
  'ID',
  'DATE',
]);

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

interface InferencePipelineTabProps {
  pipelineName: string | null;
  spans: EntitySpanResponse[];
  frames: TraceFrame[] | null | undefined;
}

/**
 * Combined right-panel tab: pipeline name + description, a compact run-summary
 * strip (spans / high-risk / mean confidence / labels), and the per-frame
 * pipeline trace.
 */
export default function InferencePipelineTab({
  pipelineName,
  spans,
  frames,
}: InferencePipelineTabProps) {
  const { data: pipelineDetail } = usePipeline(pipelineName);
  const description = pipelineDetail?.config.description?.trim();
  const withConf = spans.filter((s) => s.confidence != null);
  const avgConf = mean(withConf.map((s) => s.confidence as number));
  const highRisk = spans.filter((s) => HIGH_RISK.has(s.label.toUpperCase())).length;
  const byLabel = [...new Set(spans.map((s) => s.label))].sort();

  return (
    <div className="flex flex-col gap-3">
      {pipelineName && (
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Pipeline
          </div>
          <div className="mt-0.5 text-sm font-semibold text-gray-900">{pipelineName}</div>
          {description ? (
            <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-gray-600">
              {description}
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] italic text-gray-400">
              No description. Add one when saving this pipeline in Create.
            </p>
          )}
        </div>
      )}
      <div className="rounded-lg border border-gray-200 bg-white p-2">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-[9px] font-medium uppercase tracking-wide text-gray-400">
              Spans
            </div>
            <div className="text-sm font-semibold tabular-nums text-gray-900">{spans.length}</div>
          </div>
          <div>
            <div className="text-[9px] font-medium uppercase tracking-wide text-gray-400">
              High-risk
            </div>
            <div className="text-sm font-semibold tabular-nums text-amber-800">{highRisk}</div>
          </div>
          <div>
            <div className="text-[9px] font-medium uppercase tracking-wide text-gray-400">
              Mean conf.
            </div>
            <div className="text-sm font-semibold tabular-nums text-gray-900">
              {withConf.length === 0 ? '—' : `${(avgConf * 100).toFixed(0)}%`}
            </div>
          </div>
        </div>
        {byLabel.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 border-t border-gray-100 pt-1.5">
            {byLabel.map((l) => (
              <span
                key={l}
                className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-700"
              >
                {l}
              </span>
            ))}
          </div>
        )}
      </div>
      {frames && frames.length > 0 ? (
        <TraceTimeline frames={frames} />
      ) : (
        <p className="text-xs text-gray-400">No trace for this run.</p>
      )}
    </div>
  );
}
