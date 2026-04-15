import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/deploy';
import type { DeployConfig } from '../api/types';

export function useDeployConfig() {
  return useQuery({
    queryKey: ['deploy-config'],
    queryFn: api.getDeployConfig,
  });
}

export function useDeployablePipelines() {
  return useQuery({
    queryKey: ['deploy-pipelines'],
    queryFn: api.listDeployablePipelines,
  });
}

export function useDeployHealth() {
  return useQuery({
    queryKey: ['deploy-health'],
    queryFn: api.getDeployHealth,
  });
}

export function useUpdateDeployConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: DeployConfig) => api.updateDeployConfig(config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deploy-config'] }),
  });
}
