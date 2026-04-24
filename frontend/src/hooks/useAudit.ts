import { useQuery } from '@tanstack/react-query';
import * as api from '../api/audit';
import type { AuditLogFilters } from '../api/audit';

export function useAuditLogs(filters: AuditLogFilters = {}) {
  return useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: () => api.listAuditLogs(filters),
  });
}

export function useAuditLog(id: string | null) {
  return useQuery({
    queryKey: ['audit-log', id],
    queryFn: () => api.getAuditLog(id!),
    enabled: !!id,
  });
}

export function useAuditStats(filters: { pipeline_name?: string; source?: string } = {}) {
  return useQuery({
    queryKey: ['audit-stats', filters],
    queryFn: () => api.getAuditStats(filters),
  });
}
