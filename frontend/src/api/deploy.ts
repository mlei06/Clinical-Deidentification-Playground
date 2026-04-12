import { apiFetch } from './client';
import type { DeployConfig } from './types';

export function getDeployConfig(): Promise<DeployConfig> {
  return apiFetch('/deploy');
}

export function updateDeployConfig(config: DeployConfig): Promise<DeployConfig> {
  return apiFetch('/deploy', { method: 'PUT', body: JSON.stringify(config) });
}

export function listDeployablePipelines(): Promise<string[]> {
  return apiFetch('/deploy/pipelines');
}
