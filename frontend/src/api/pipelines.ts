import { apiFetch } from './client';
import type {
  CreatePipelineRequest,
  PipelineConfig,
  PipelineDetail,
  PipeTypeInfo,
  ValidatePipelineResponse,
} from './types';

export function listPipelines(): Promise<PipelineDetail[]> {
  return apiFetch('/pipelines');
}

export function getPipeline(name: string): Promise<PipelineDetail> {
  return apiFetch(`/pipelines/${encodeURIComponent(name)}`);
}

export function createPipeline(req: CreatePipelineRequest): Promise<PipelineDetail> {
  return apiFetch('/pipelines', { method: 'POST', body: JSON.stringify(req) });
}

export function updatePipeline(name: string, config: PipelineConfig): Promise<PipelineDetail> {
  return apiFetch(`/pipelines/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify({ config }),
  });
}

export function deletePipeline(name: string): Promise<void> {
  return apiFetch(`/pipelines/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export function validatePipeline(
  name: string,
  config?: PipelineConfig,
): Promise<ValidatePipelineResponse> {
  return apiFetch(`/pipelines/${encodeURIComponent(name)}/validate`, {
    method: 'POST',
    body: JSON.stringify(config ? { config } : {}),
  });
}

export function listPipeTypes(): Promise<PipeTypeInfo[]> {
  return apiFetch('/pipelines/pipe-types');
}

export interface ComputePipeLabelsResponse {
  labels: string[];
  neuroner_model?: string | null;
  neuroner_manifest_labels?: string[] | null;
}

export function computePipeLabels(
  name: string,
  config?: Record<string, unknown>,
): Promise<ComputePipeLabelsResponse> {
  return apiFetch(`/pipelines/pipe-types/${encodeURIComponent(name)}/labels`, {
    method: 'POST',
    body: JSON.stringify({ config: config ?? null }),
  });
}

/** Raw manifest labels for every NeuroNER model + default entity_map (one GET per session). */
export interface NeuronerLabelSpaceBundle {
  labels_by_model: Record<string, string[]>;
  default_entity_map: Record<string, string>;
  default_model: string;
}

export function fetchNeuronerLabelSpaceBundle(): Promise<NeuronerLabelSpaceBundle> {
  return apiFetch('/pipelines/pipe-types/neuroner_ner/label-space-bundle');
}
