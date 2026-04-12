import { useQuery } from '@tanstack/react-query';
import * as api from '../api/audit';
import type { AuditLogFilters, AuditSource } from '../api/audit';

export function useAuditLogs(filters: AuditLogFilters = {}, source: AuditSource = 'local') {
  return useQuery({
    queryKey: ['audit-logs', source, filters],
    queryFn: () => api.listAuditLogs(filters, source),
  });
}

export function useAuditLog(id: string | null, source: AuditSource = 'local') {
  return useQuery({
    queryKey: ['audit-log', source, id],
    queryFn: () => api.getAuditLog(id!, source),
    enabled: !!id,
  });
}

export function useAuditStats(
  filters: { pipeline_name?: string; source?: string } = {},
  source: AuditSource = 'local',
) {
  return useQuery({
    queryKey: ['audit-stats', source, filters],
    queryFn: () => api.getAuditStats(filters, source),
  });
}
