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

/** Per-model keys into ``entity_map`` + defaults — NeuroNER (raw tags) or Presidio (entity names). One GET per session. */
export interface LabelSpaceBundle {
  labels_by_model: Record<string, string[]>;
  default_entity_map: Record<string, string>;
  default_model: string;
}

/** @deprecated alias — use ``LabelSpaceBundle`` */
export type NeuronerLabelSpaceBundle = LabelSpaceBundle;

export function fetchNeuronerLabelSpaceBundle(): Promise<LabelSpaceBundle> {
  return apiFetch('/pipelines/pipe-types/neuroner_ner/label-space-bundle');
}

export function fetchPresidioLabelSpaceBundle(): Promise<LabelSpaceBundle> {
  return apiFetch('/pipelines/pipe-types/presidio_ner/label-space-bundle');
}
