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

/** Per-model label keys + default ``entity_map`` for any detector with ``label_source: 'bundle'``.
 * Key shape (raw NER tag vs. Presidio entity) is signaled by ``PipeTypeInfo.bundle_key_semantics``.
 */
export interface LabelSpaceBundle {
  labels_by_model: Record<string, string[]>;
  default_entity_map: Record<string, string>;
  default_model: string;
}

export function fetchLabelSpaceBundle(pipeType: string): Promise<LabelSpaceBundle> {
  return apiFetch(`/pipelines/pipe-types/${encodeURIComponent(pipeType)}/label-space-bundle`);
}
