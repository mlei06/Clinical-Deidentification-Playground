import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/datasets';
import type {
  RegisterDatasetRequest,
  ComposeRequest,
  TransformRequest,
  TransformPreviewRequest,
  GenerateRequest,
  ExportTrainingRequest,
} from '../api/types';

export function useDatasets() {
  return useQuery({
    queryKey: ['datasets'],
    queryFn: () => api.listDatasets(),
  });
}

export function useImportSources() {
  return useQuery({
    queryKey: ['datasets', 'import-sources'],
    queryFn: () => api.listImportSources(),
  });
}

export function useDataset(name: string | null) {
  return useQuery({
    queryKey: ['datasets', name],
    queryFn: () => api.getDataset(name!),
    enabled: !!name,
  });
}

export function useDatasetSchema(name: string | null) {
  return useQuery({
    queryKey: ['datasets', name, 'schema'],
    queryFn: () => api.getDatasetSchema(name!),
    enabled: !!name,
  });
}

export function useDatasetPreview(name: string | null, offset = 0, limit = 20) {
  return useQuery({
    queryKey: ['datasets', name, 'preview', offset, limit],
    queryFn: () => api.previewDataset(name!, { offset, limit }),
    enabled: !!name,
  });
}

export function useDocument(datasetName: string | null, docId: string | null) {
  return useQuery({
    queryKey: ['datasets', datasetName, 'documents', docId],
    queryFn: () => api.getDocument(datasetName!, docId!),
    enabled: !!datasetName && !!docId,
  });
}

export function useRegisterDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: RegisterDatasetRequest) => api.registerDataset(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['datasets'] }),
  });
}

export function useDeleteDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.deleteDataset(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['datasets'] }),
  });
}

export function useRefreshAnalytics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.refreshDatasetAnalytics(name),
    onSuccess: (_data, name) => {
      qc.invalidateQueries({ queryKey: ['datasets'] });
      qc.invalidateQueries({ queryKey: ['datasets', name] });
    },
  });
}

export function useComposeDatasets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ComposeRequest) => api.composeDatasets(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['datasets'] }),
  });
}

export function useTransformDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: TransformRequest) => api.transformDataset(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['datasets'] }),
  });
}

export function usePreviewTransform() {
  return useMutation({
    mutationFn: (req: TransformPreviewRequest) => api.previewTransform(req),
  });
}

export function useGenerateDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: GenerateRequest) => api.generateDataset(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['datasets'] }),
  });
}

export function useExportDataset(name: string) {
  return useMutation({
    mutationFn: (req: ExportTrainingRequest) => api.exportDataset(name, req),
  });
}
