import { apiFetch } from './client';

export interface DatasetUploadResult {
  name: string;
  document_count: number;
  total_spans: number;
  labels: string[];
  description: string;
  data_path: string;
  format: string;
  created_at: string;
  analytics: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export function uploadDataset(params: {
  name: string;
  file: Blob;
  filename: string;
  description?: string;
  lineFormat: 'annotated_jsonl' | 'production_v1';
}): Promise<DatasetUploadResult> {
  const form = new FormData();
  form.append('name', params.name);
  form.append('file', params.file, params.filename);
  if (params.description) form.append('description', params.description);
  form.append('line_format', params.lineFormat);
  return apiFetch<DatasetUploadResult>('/datasets/upload', { method: 'POST', body: form });
}
