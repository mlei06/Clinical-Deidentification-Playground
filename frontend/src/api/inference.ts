import { apiFetch } from './client';
import type { ProcessResponse, SavedInferenceRunDetail, SavedInferenceRunSummary } from './types';

export function listInferenceRuns(): Promise<SavedInferenceRunSummary[]> {
  return apiFetch('/inference/runs');
}

export function saveInferenceSnapshot(body: ProcessResponse): Promise<SavedInferenceRunDetail> {
  return apiFetch('/inference/runs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getInferenceRun(runId: string): Promise<SavedInferenceRunDetail> {
  return apiFetch(`/inference/runs/${encodeURIComponent(runId)}`);
}

export function deleteInferenceRun(runId: string): Promise<void> {
  return apiFetch(`/inference/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' });
}
