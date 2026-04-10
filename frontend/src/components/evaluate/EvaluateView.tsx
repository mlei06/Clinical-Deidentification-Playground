import { useState } from 'react';
import EvalRunForm from './EvalRunForm';
import EvalRunList from './EvalRunList';
import EvalDashboard from './EvalDashboard';
import EvalCompare from './EvalCompare';
import { useEvalRun } from '../../hooks/useEvalRuns';
import type { EvalRunDetail, EvalCompareResponse } from '../../api/types';

export default function EvaluateView() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [compareResult, setCompareResult] = useState<EvalCompareResponse | null>(null);

  const { data: selectedRun } = useEvalRun(selectedRunId);

  const handleResult = (run: EvalRunDetail) => {
    setSelectedRunId(run.id);
    setCompareResult(null);
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto p-6">
      <EvalRunForm onResult={handleResult} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">
            Past Runs
          </h3>
          <EvalRunList onSelect={setSelectedRunId} selectedId={selectedRunId} />
        </div>
        <div className="lg:col-span-2">
          {selectedRun && <EvalDashboard run={selectedRun} />}
          {compareResult && <EvalCompare data={compareResult} />}
          {!selectedRun && !compareResult && (
            <div className="flex h-40 items-center justify-center text-sm text-gray-400">
              Select a run to view results, or run a new evaluation
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
