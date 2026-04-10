import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import type { EvalCompareResponse } from '../../api/types';

interface EvalCompareProps {
  data: EvalCompareResponse;
}

function DeltaIndicator({ value }: { value: number }) {
  if (Math.abs(value) < 0.001)
    return <Minus size={12} className="text-gray-400" />;
  if (value > 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-green-600">
        <ArrowUp size={12} />+{(value * 100).toFixed(1)}%
      </span>
    );
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-red-600">
      <ArrowDown size={12} />{(value * 100).toFixed(1)}%
    </span>
  );
}

export default function EvalCompare({ data }: EvalCompareProps) {
  const { run_a, run_b, delta_strict_f1, delta_risk_weighted_recall } = data;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Comparison
      </div>
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div />
        <div className="font-medium text-gray-700">{run_a.pipeline_name}</div>
        <div className="font-medium text-gray-700">{run_b.pipeline_name}</div>

        <div className="text-gray-500">Strict F1</div>
        <div>{(run_a.strict_f1 * 100).toFixed(1)}%</div>
        <div className="flex items-center gap-2">
          {(run_b.strict_f1 * 100).toFixed(1)}%
          <DeltaIndicator value={delta_strict_f1} />
        </div>

        <div className="text-gray-500">Risk Recall</div>
        <div>{(run_a.risk_weighted_recall * 100).toFixed(1)}%</div>
        <div className="flex items-center gap-2">
          {(run_b.risk_weighted_recall * 100).toFixed(1)}%
          <DeltaIndicator value={delta_risk_weighted_recall} />
        </div>

        <div className="text-gray-500">Documents</div>
        <div>{run_a.document_count}</div>
        <div>{run_b.document_count}</div>
      </div>
    </div>
  );
}
