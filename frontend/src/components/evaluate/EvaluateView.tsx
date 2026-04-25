import { useState } from 'react';
import EvalRunForm from './EvalRunForm';
import EvalRunList from './EvalRunList';
import EvalDashboard from './EvalDashboard';
import EvalCompare from './EvalCompare';
import { useEvalRun } from '../../hooks/useEvalRuns';
import type { EvalRunDetail, EvalCompareResponse } from '../../api/types';

export default function EvaluateView() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [latestRunResult, setLatestRunResult] = useState<EvalRunDetail | null>(null);
  const [compareResult, setCompareResult] = useState<EvalCompareResponse | null>(null);

  const { data: selectedRun } = useEvalRun(selectedRunId);
  const runForDashboard =
    latestRunResult && selectedRunId === latestRunResult.id ? latestRunResult : selectedRun;

  const handleResult = (run: EvalRunDetail) => {
    setLatestRunResult(run);
    setSelectedRunId(run.id);
    setCompareResult(null);
  };

  const handleSelectRun = (runId: string) => {
    setSelectedRunId(runId);
    // Switching to a different run should show persisted history data.
    if (latestRunResult && runId !== latestRunResult.id) {
      setLatestRunResult(null);
    }
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
          <EvalRunList onSelect={handleSelectRun} selectedId={selectedRunId} />
        </div>
        <div className="lg:col-span-2">
          {runForDashboard && <EvalDashboard run={runForDashboard} />}
          {compareResult && <EvalCompare data={compareResult} />}
          {!runForDashboard && !compareResult && (
            <div className="flex h-40 items-center justify-center text-sm text-gray-400">
              Select a run to view results, or run a new evaluation
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
