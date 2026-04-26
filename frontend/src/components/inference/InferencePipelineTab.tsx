import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Network, RefreshCw } from 'lucide-react';
import TraceTimeline from './TraceTimeline';
import { usePipeline } from '../../hooks/usePipelines';
import { validatePipeline } from '../../api/pipelines';
import type { EntitySpanResponse, TraceFrame } from '../../api/types';
import { ApiError } from '../../api/client';

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

interface LiveLabelState {
  labels: string[];
  at?: string;
  error?: string;
}

interface InferencePipelineTabProps {
  pipelineName: string | null;
  spans: EntitySpanResponse[];
  frames: TraceFrame[] | null | undefined;
}

function outputSpaceFor(
  detail: { config: { output_label_space?: string[]; output_label_space_updated_at?: string } } | undefined,
  live: LiveLabelState | null,
) {
  if (live?.error) {
    return { kind: 'error' as const, message: live.error };
  }
  if (live?.labels?.length) {
    return { kind: 'labels' as const, labels: live.labels, at: live.at };
  }
  if (!detail?.config) {
    return { kind: 'missing' as const };
  }
  const cached = detail.config.output_label_space;
  if (cached?.length) {
    return {
      kind: 'labels' as const,
      labels: cached,
      at: detail.config.output_label_space_updated_at,
    };
  }
  return { kind: 'missing' as const };
}

/**
 * Right-panel Pipeline tab: name, description, run summary, **final output label space**
 * (same idea as Pipelines catalog), and trace.
 */
export default function InferencePipelineTab({
  pipelineName,
  spans,
  frames,
}: InferencePipelineTabProps) {
  const { data: pipelineDetail } = usePipeline(pipelineName);
  const queryClient = useQueryClient();
  const [liveLabels, setLiveLabels] = useState<LiveLabelState | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setLiveLabels(null);
  }, [pipelineName]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const validateMut = useMutation({
    mutationFn: async (name: string) => {
      const r = await validatePipeline(name);
      if (!r.valid) {
        throw new Error(r.error || 'validate failed');
      }
      return { name, r };
    },
    onSuccess: ({ name, r }) => {
      setLiveLabels({
        labels: r.output_label_space ?? [],
        at: r.output_label_space_updated_at ?? undefined,
      });
      void queryClient.invalidateQueries({ queryKey: ['pipelines', name] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.detail : e instanceof Error ? e.message : 'error';
      setLiveLabels({ labels: [], error: String(msg) });
    },
  });

  const description = pipelineDetail?.config.description?.trim();
  const withConf = spans.filter((s) => s.confidence != null);
  const avgConf = mean(withConf.map((s) => s.confidence as number));
  const highRisk = spans.filter((s) => HIGH_RISK.has(s.label.toUpperCase())).length;
  const byLabel = [...new Set(spans.map((s) => s.label))].sort();

  const o = outputSpaceFor(pipelineDetail, liveLabels);

  return (
    <div className="flex flex-col gap-3">
      {pipelineName && (
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Pipeline</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <Network size={14} className="shrink-0 text-gray-400" />
            {pipelineName}
          </div>
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

      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
          Final output label space
        </h3>
        <p className="mt-1 text-[10px] leading-snug text-gray-500">
          Symbolic labels at the end of the pipeline (after <code className="text-[9px]">label_mapper</code> / filters).
          Cached when the pipeline is saved; use compute to refresh from the current JSON.
        </p>
        {pipelineName && (() => {
          if (o.kind === 'error') {
            return (
              <p className="mt-2 text-xs text-red-700" role="alert">
                {o.message}
              </p>
            );
          }
          if (o.kind === 'labels' && o.labels.length) {
            return (
              <div className="mt-2">
                <div className="flex flex-wrap gap-1.5">
                  {o.labels.map((lab) => (
                    <span
                      key={lab}
                      className="inline-flex rounded bg-violet-50 px-2 py-0.5 font-mono text-xs text-violet-900"
                    >
                      {lab}
                    </span>
                  ))}
                </div>
                {o.at && <p className="mt-2 text-[10px] text-gray-400">Updated {o.at}</p>}
              </div>
            );
          }
          return (
            <p className="mt-2 text-xs text-gray-500">
              Not cached. Compute loads the built pipeline and evaluates effective output labels.
            </p>
          );
        })()}
        {pipelineName && (
          <div className="mt-2">
            <button
              type="button"
              disabled={validateMut.isPending}
              onClick={() => {
                setLiveLabels(null);
                validateMut.mutate(pipelineName);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            >
              {validateMut.isPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              Compute / refresh output labels
            </button>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-2">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-[9px] font-medium uppercase tracking-wide text-gray-400">Spans</div>
            <div className="text-sm font-semibold tabular-nums text-gray-900">{spans.length}</div>
          </div>
          <div>
            <div className="text-[9px] font-medium uppercase tracking-wide text-gray-400">High-risk</div>
            <div className="text-sm font-semibold tabular-nums text-amber-800">{highRisk}</div>
          </div>
          <div>
            <div className="text-[9px] font-medium uppercase tracking-wide text-gray-400">Mean conf.</div>
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
