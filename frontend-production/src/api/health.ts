import { apiFetch } from './client';

export interface HealthResponse {
  status: string;
  label_space_name: string;
  risk_profile_name: string;
  api_key_scope?: 'admin' | 'inference' | null;
}

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health');
}
