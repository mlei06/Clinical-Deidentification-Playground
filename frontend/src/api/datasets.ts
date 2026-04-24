import { apiFetch } from './client';
import type {
  DatasetSummary,
  DatasetDetail,
  DocumentDetail,
  RegisterDatasetRequest,
  ImportBratRequest,
  ImportSourcesResponse,
  BratImportSourcesResponse,
  RefreshResultEntry,
  ComposeRequest,
  TransformRequest,
  TransformPreviewRequest,
  TransformPreviewResponse,
  DatasetSchemaResponse,
  DatasetPreviewResponse,
  DatasetAnalytics,
  GenerateRequest,
  ExportTrainingRequest,
  ExportTrainingResponse,
  UpdateDocumentRequest,
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

export function getDatasetSchema(name: string): Promise<DatasetSchemaResponse> {
  return apiFetch(`/datasets/${encodeURIComponent(name)}/schema`);
}

export function registerDataset(req: RegisterDatasetRequest): Promise<DatasetDetail> {
  return apiFetch('/datasets', { method: 'POST', body: JSON.stringify(req) });
}

export function importBrat(req: ImportBratRequest): Promise<DatasetDetail> {
  return apiFetch('/datasets/import/brat', { method: 'POST', body: JSON.stringify(req) });
}

export function listImportSources(): Promise<ImportSourcesResponse> {
  return apiFetch('/datasets/import-sources');
}

export function listBratImportSources(): Promise<BratImportSourcesResponse> {
  return apiFetch('/datasets/import-sources/brat');
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

export function refreshAllDatasets(): Promise<RefreshResultEntry[]> {
  return apiFetch('/datasets/refresh-all', { method: 'POST' });
}

export function getDatasetAnalytics(
  name: string,
  params?: { split?: string | null },
): Promise<DatasetAnalytics> {
  const qs = new URLSearchParams();
  if (params?.split != null && params.split !== '') {
    qs.set('split', params.split);
  }
  const q = qs.toString();
  return apiFetch(`/datasets/${encodeURIComponent(name)}/analytics${q ? `?${q}` : ''}`);
}

export function previewDataset(
  name: string,
  params?: { limit?: number; offset?: number; splits?: string[] | null },
): Promise<DatasetPreviewResponse> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  if (params?.splits && params.splits.length > 0) {
    qs.set('splits', params.splits.join(','));
  }
  const q = qs.toString();
  return apiFetch(`/datasets/${encodeURIComponent(name)}/preview${q ? `?${q}` : ''}`);
}

export function getDocument(name: string, docId: string): Promise<DocumentDetail> {
  return apiFetch(
    `/datasets/${encodeURIComponent(name)}/documents/${encodeURIComponent(docId)}`,
  );
}

export function updateDocument(
  name: string,
  docId: string,
  body: UpdateDocumentRequest,
): Promise<DocumentDetail> {
  return apiFetch(
    `/datasets/${encodeURIComponent(name)}/documents/${encodeURIComponent(docId)}`,
    { method: 'PUT', body: JSON.stringify(body) },
  );
}

export function composeDatasets(req: ComposeRequest): Promise<DatasetDetail> {
  return apiFetch('/datasets/compose', { method: 'POST', body: JSON.stringify(req) });
}

export function transformDataset(req: TransformRequest): Promise<DatasetDetail> {
  return apiFetch('/datasets/transform', { method: 'POST', body: JSON.stringify(req) });
}

export function previewTransform(
  req: TransformPreviewRequest,
): Promise<TransformPreviewResponse> {
  return apiFetch('/datasets/transform/preview', {
    method: 'POST',
    body: JSON.stringify(req),
  });
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
