import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/evaluation';
import type { EvalRunRequest } from '../api/types';

export function useEvalRuns(pipelineName?: string) {
  return useQuery({
    queryKey: ['eval-runs', pipelineName],
    queryFn: () => api.listEvalRuns({ pipeline_name: pipelineName }),
  });
}

export function useEvalRun(id: string | null) {
  return useQuery({
    queryKey: ['eval-runs', id],
    queryFn: () => api.getEvalRun(id!),
    enabled: !!id,
  });
}

export function useRunEvaluation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: EvalRunRequest) => api.runEvaluation(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['eval-runs'] }),
  });
}

export function useCompareEvalRuns() {
  return useMutation({
    mutationFn: ({ a, b }: { a: string; b: string }) => api.compareEvalRuns(a, b),
  });
}
