import { apiFetch } from './client';
import type { AuditLogDetail, AuditLogSummary, AuditStats } from './types';

export type AuditSource = 'local' | 'production';

export interface AuditLogFilters {
  pipeline_name?: string;
  source?: string;
  command?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
}

function basePath(src: AuditSource): string {
  return src === 'production' ? '/audit/production' : '/audit';
}

function buildQs(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export function listAuditLogs(
  filters: AuditLogFilters = {},
  source: AuditSource = 'local',
): Promise<AuditLogSummary[]> {
  return apiFetch(`${basePath(source)}/logs${buildQs(filters)}`);
}

export function getAuditLog(id: string, source: AuditSource = 'local'): Promise<AuditLogDetail> {
  return apiFetch(`${basePath(source)}/logs/${encodeURIComponent(id)}`);
}

export function getAuditStats(
  filters: { pipeline_name?: string; source?: string } = {},
  source: AuditSource = 'local',
): Promise<AuditStats> {
  return apiFetch(`${basePath(source)}/stats${buildQs(filters)}`);
}
