import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import { clsx } from 'clsx';
import { useDataset } from '../../hooks/useDatasets';
import { usePipeline } from '../../hooks/usePipelines';
import { useHealth } from '../../hooks/useHealth';

type SourceMode = 'registered' | 'path';

function labelChips(
  title: string,
  labels: string[],
  className: string,
) {
  if (labels.length === 0) {
    return (
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{title}</div>
        <p className="text-xs text-gray-400">—</p>
      </div>
    );
  }
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{title}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {labels.map((l) => (
          <span
            key={l}
            className={clsx('rounded px-1.5 py-0.5 text-[11px] font-mono', className)}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

function setDiff(a: Set<string>, b: Set<string>) {
  const onlyA: string[] = [];
  const onlyB: string[] = [];
  const both: string[] = [];
  for (const x of Array.from(a).sort((x, y) => x.localeCompare(y))) {
    if (b.has(x)) both.push(x);
    else onlyA.push(x);
  }
  for (const x of Array.from(b).sort((x, y) => x.localeCompare(y))) {
    if (!a.has(x)) onlyB.push(x);
  }
  return { onlyA, onlyB, both };
}

interface EvalLabelAlignmentProps {
  sourceMode: SourceMode;
  datasetName: string;
  pipelineName: string;
}

/**
 * Compare raw gold label set (dataset analytics) with symbolic pipeline
 * `output_label_space` before running eval. Eval uses raw string equality on labels.
 */
export default function EvalLabelAlignment({ sourceMode, datasetName, pipelineName }: EvalLabelAlignmentProps) {
  const { data: health } = useHealth();
  const detailQuery = useDataset(sourceMode === 'registered' && datasetName.trim() ? datasetName.trim() : null);
  const pipelineQuery = usePipeline(pipelineName.trim() ? pipelineName.trim() : null);

  if (sourceMode === 'path') {
    return (
      <div className="rounded-md border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-950">
        <p className="font-medium">Label alignment preview</p>
        <p className="mt-1 text-amber-900/90">
          Register this JSONL as a <strong>dataset</strong> to compare its gold label set with the
          selected pipeline&apos;s <code className="rounded bg-amber-100/80 px-0.5">output_label_space</code>{' '}
          here. Server path mode does not expose gold labels in this panel.
        </p>
        <p className="mt-1.5">
          <Link
            to="/datasets"
            className="font-medium text-amber-950 underline decoration-amber-400 underline-offset-2 hover:text-amber-900"
          >
            Datasets
          </Link>
        </p>
      </div>
    );
  }

  if (!datasetName.trim() || !pipelineName.trim()) {
    return null;
  }

  if (detailQuery.isLoading || pipelineQuery.isLoading) {
    return (
      <p className="text-xs text-gray-400" aria-live="polite">
        Loading label alignment…
      </p>
    );
  }

  if (detailQuery.isError) {
    return (
      <p className="text-xs text-red-600">
        Could not load dataset: {(detailQuery.error as Error).message}
      </p>
    );
  }
  if (pipelineQuery.isError) {
    return (
      <p className="text-xs text-red-600">
        Could not load pipeline: {(pipelineQuery.error as Error).message}
      </p>
    );
  }

  const d = detailQuery.data;
  const p = pipelineQuery.data;
  if (!d || !p) return null;

  const goldLabels = d.labels ?? [];
  const outSpace = p.config?.output_label_space;
  const pipelineLabels = Array.isArray(outSpace) ? outSpace : [];

  const goldSet = new Set(goldLabels);
  const pipeSet = new Set(pipelineLabels);
  const { onlyA, onlyB, both } = setDiff(goldSet, pipeSet);
  const mismatch = onlyA.length > 0 || onlyB.length > 0;
  const missingOutput = pipelineLabels.length === 0;
  const loadHref = `/create?load=${encodeURIComponent(pipelineName.trim())}`;

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">Label alignment (raw)</h4>
        {mismatch || missingOutput ? (
          <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
            <AlertTriangle size={12} />
            Check labels
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
            <CheckCircle2 size={12} />
            Sets match
          </span>
        )}
      </div>

      <p className="text-xs leading-relaxed text-gray-600">
        Evaluation uses <strong>exact</strong> string labels on gold vs predicted spans (and boundaries). It does
        <strong> not</strong> use <code className="rounded bg-gray-100 px-0.5">CLINICAL_DEID_LABEL_SPACE_NAME</code> at
        eval time. If gold and pipeline disagree, add a <strong>label_mapper</strong> (or change the corpus) so
        names match. See the repo&apos;s <code className="rounded bg-gray-100 px-0.5">docs/pipes-and-pipelines.md</code> for
        pipe types.
      </p>

      {health && (
        <p className="text-[11px] text-gray-500">
          <strong>Inference</strong> <code className="rounded bg-gray-100 px-0.5">POST /process</code> normalizes
          response labels with label space <span className="font-mono">{health.label_space_name}</span> (and default
          risk profile <span className="font-mono">{health.risk_profile_name}</span> for risk-weighted eval metrics);
          that is separate from this comparison.
        </p>
      )}

      {missingOutput && (
        <p className="text-xs text-amber-800">
          Pipeline has no <code className="rounded bg-amber-100 px-0.5">output_label_space</code> in config — save
          or validate the pipeline in the builder to refresh computed labels, or the chain could not be folded
          symbolically.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {labelChips('Only in gold dataset', onlyA, 'bg-rose-100/90 text-rose-900')}
        {labelChips('Only in pipeline output space', onlyB, 'bg-sky-100/80 text-sky-900')}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {labelChips('In both', both, 'bg-gray-100 text-gray-800')}
        {labelChips(
          'All gold labels',
          goldLabels.slice().sort((a, b) => a.localeCompare(b)),
          'bg-white text-gray-700 ring-1 ring-gray-200',
        )}
      </div>
      <div>
        {labelChips('Pipeline output_label_space (symbolic)', pipelineLabels, 'bg-violet-50 text-violet-900 ring-1 ring-violet-100')}
      </div>

      {(mismatch || missingOutput) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
          <Link
            to={loadHref}
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-900 underline decoration-gray-300 underline-offset-2 hover:decoration-gray-500"
          >
            Open pipeline in builder
            <ExternalLink size={12} className="opacity-60" />
          </Link>
        </div>
      )}
    </div>
  );
}
