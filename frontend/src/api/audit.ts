import { apiFetch } from './client';
import type { AuditLogDetail, AuditLogSummary, AuditStats } from './types';

export interface AuditLogFilters {
  pipeline_name?: string;
  source?: string;
  command?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
}

function buildQs(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export function listAuditLogs(filters: AuditLogFilters = {}): Promise<AuditLogSummary[]> {
  return apiFetch(`/audit/logs${buildQs(filters as Record<string, string | number | undefined>)}`);
}

export function getAuditLog(id: string): Promise<AuditLogDetail> {
  return apiFetch(`/audit/logs/${encodeURIComponent(id)}`);
}

export function getAuditStats(
  filters: { pipeline_name?: string; source?: string } = {},
): Promise<AuditStats> {
  return apiFetch(`/audit/stats${buildQs(filters)}`);
}
