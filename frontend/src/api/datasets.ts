import { apiFetch } from './client';
import type {
  DatasetSummary,
  DatasetDetail,
  DocumentPreview,
  DocumentDetail,
  RegisterDatasetRequest,
  ComposeRequest,
  TransformRequest,
  GenerateRequest,
  ExportTrainingRequest,
  ExportTrainingResponse,
} from './types';

export function listDatasets(params?: {
  limit?: number;
  offset?: number;
}): Promise<DatasetSummary[]> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  const q = qs.toString();
  return apiFetch(`/datasets${q ? `?${q}` : ''}`);
}

export function getDataset(name: string): Promise<DatasetDetail> {
  return apiFetch(`/datasets/${encodeURIComponent(name)}`);
}

export function registerDataset(req: RegisterDatasetRequest): Promise<DatasetDetail> {
  return apiFetch('/datasets', { method: 'POST', body: JSON.stringify(req) });
}

export function updateDataset(
  name: string,
  body: { description?: string; metadata?: Record<string, unknown> },
): Promise<DatasetDetail> {
  return apiFetch(`/datasets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function deleteDataset(name: string): Promise<void> {
  return apiFetch(`/datasets/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export function refreshDatasetAnalytics(name: string): Promise<DatasetDetail> {
  return apiFetch(`/datasets/${encodeURIComponent(name)}/refresh`, { method: 'POST' });
}

export function previewDataset(
  name: string,
  params?: { limit?: number; offset?: number },
): Promise<DocumentPreview[]> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  const q = qs.toString();
  return apiFetch(`/datasets/${encodeURIComponent(name)}/preview${q ? `?${q}` : ''}`);
}

export function getDocument(name: string, docId: string): Promise<DocumentDetail> {
  return apiFetch(
    `/datasets/${encodeURIComponent(name)}/documents/${encodeURIComponent(docId)}`,
  );
}

export function composeDatasets(req: ComposeRequest): Promise<DatasetDetail> {
  return apiFetch('/datasets/compose', { method: 'POST', body: JSON.stringify(req) });
}

export function transformDataset(req: TransformRequest): Promise<DatasetDetail> {
  return apiFetch('/datasets/transform', { method: 'POST', body: JSON.stringify(req) });
}

export function generateDataset(req: GenerateRequest): Promise<DatasetDetail> {
  return apiFetch('/datasets/generate', { method: 'POST', body: JSON.stringify(req) });
}

export function exportDataset(
  name: string,
  req: ExportTrainingRequest,
): Promise<ExportTrainingResponse> {
  return apiFetch(`/datasets/${encodeURIComponent(name)}/export`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}
