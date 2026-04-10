import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/pipelines';
import type { CreatePipelineRequest, PipelineConfig } from '../api/types';

export function usePipelines() {
  return useQuery({
    queryKey: ['pipelines'],
    queryFn: api.listPipelines,
  });
}

export function usePipeline(name: string | null) {
  return useQuery({
    queryKey: ['pipelines', name],
    queryFn: () => api.getPipeline(name!),
    enabled: !!name,
  });
}

export function useCreatePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreatePipelineRequest) => api.createPipeline(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pipelines'] }),
  });
}

export function useUpdatePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, config }: { name: string; config: PipelineConfig }) =>
      api.updatePipeline(name, config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pipelines'] }),
  });
}

export function useDeletePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.deletePipeline(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pipelines'] }),
  });
}
