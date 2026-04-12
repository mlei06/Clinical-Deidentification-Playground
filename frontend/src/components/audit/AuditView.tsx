import { useState } from 'react';
import { Loader2, ChevronDown, ChevronRight, Activity, Clock, FileText, Hash, Globe, Monitor, AlertCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuditLogs, useAuditLog, useAuditStats } from '../../hooks/useAudit';
import { useDeployConfig } from '../../hooks/useDeploy';
import type { AuditSource } from '../../api/audit';
import type { AuditLogSummary } from '../../api/types';

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ size: number; className?: string }>;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
        <Icon size={12} className="text-gray-400" />
        {label}
      </div>
      <div className="text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString();
}

export default function AuditView() {
  const { data: deployConfig } = useDeployConfig();
  const hasProductionUrl = !!deployConfig?.production_api_url;

  const [auditSource, setAuditSource] = useState<AuditSource>('local');
  const [pipelineFilter, setPipelineFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const filters = {
    pipeline_name: pipelineFilter || undefined,
    source: sourceFilter || undefined,
    limit: pageSize,
    offset: page * pageSize,
  };

  const { data: logs = [], isLoading: logsLoading, isError: logsError, error: logsErrorObj } = useAuditLogs(filters, auditSource);
  const { data: stats } = useAuditStats(
    { pipeline_name: pipelineFilter || undefined, source: sourceFilter || undefined },
    auditSource,
  );
  const { data: detail, isLoading: detailLoading } = useAuditLog(selectedId, auditSource);

  const resetFilters = () => {
    setSelectedId(null);
    setPage(0);
  };

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Header + source toggle */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Activity size={20} />
                Audit Log
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Monitor pipeline usage, performance, and client activity.
              </p>
            </div>

            {/* Source toggle — only show when production URL is configured */}
            {hasProductionUrl && (
              <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
                <button
                  onClick={() => { setAuditSource('local'); resetFilters(); }}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors',
                    auditSource === 'local'
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-600 hover:bg-gray-50',
                  )}
                >
                  <Monitor size={14} />
                  Local
                </button>
                <button
                  onClick={() => { setAuditSource('production'); resetFilters(); }}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors',
                    auditSource === 'production'
                      ? 'bg-green-700 text-white'
                      : 'text-gray-600 hover:bg-gray-50',
                  )}
                >
                  <Globe size={14} />
                  Production
                </button>
              </div>
            )}
          </div>

          {/* Connection error banner */}
          {logsError && auditSource === 'production' && (
            <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Cannot reach production API</p>
                <p className="mt-0.5 text-xs text-red-600">
                  {(logsErrorObj as Error)?.message ?? 'Connection failed'}. Check the production URL in the Deploy tab.
                </p>
              </div>
            </div>
          )}

          {/* Source indicator for production */}
          {auditSource === 'production' && !logsError && (
            <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
              <Globe size={14} />
              Showing logs from production: <span className="font-mono text-xs">{deployConfig?.production_api_url}</span>
            </div>
          )}

          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-4 gap-3">
              <StatCard icon={Hash} label="Total Requests" value={stats.total_requests} />
              <StatCard
                icon={Clock}
                label="Avg Duration"
                value={formatDuration(stats.avg_duration_seconds)}
              />
              <StatCard icon={FileText} label="Total Spans Detected" value={stats.total_spans_detected} />
              <StatCard
                icon={Activity}
                label="Sources"
                value={Object.keys(stats.source_breakdown).length}
              />
            </div>
          )}

          {/* Top pipelines bar */}
          {stats && stats.top_pipelines.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-900 mb-2">Top Pipelines</h2>
              <div className="space-y-1.5">
                {stats.top_pipelines.map((tp) => {
                  const maxCount = stats.top_pipelines[0].request_count;
                  const pct = maxCount > 0 ? (tp.request_count / maxCount) * 100 : 0;
                  return (
                    <div key={tp.pipeline_name} className="flex items-center gap-3">
                      <span className="w-40 text-xs font-mono text-gray-700 truncate">
                        {tp.pipeline_name}
                      </span>
                      <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 w-12 text-right">
                        {tp.request_count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Source breakdown */}
          {stats && Object.keys(stats.source_breakdown).length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-900 mb-2">By Source</h2>
              <div className="flex gap-2">
                {Object.entries(stats.source_breakdown).map(([src, count]) => (
                  <div
                    key={src}
                    className="rounded-md border border-gray-200 bg-white px-3 py-2 text-center"
                  >
                    <div className="text-xs text-gray-500">{src}</div>
                    <div className="text-sm font-semibold text-gray-900">{count}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Filters */}
          <div className="flex gap-3 items-end">
            <label>
              <span className="text-xs text-gray-500">Pipeline</span>
              <input
                type="text"
                value={pipelineFilter}
                onChange={(e) => {
                  setPipelineFilter(e.target.value);
                  setPage(0);
                }}
                placeholder="Filter by pipeline..."
                className="mt-0.5 block w-48 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label>
              <span className="text-xs text-gray-500">Source</span>
              <select
                value={sourceFilter}
                onChange={(e) => {
                  setSourceFilter(e.target.value);
                  setPage(0);
                }}
                className="mt-0.5 block rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">All sources</option>
                <option value="api">api</option>
                <option value="production-api">production-api</option>
                <option value="cli">cli</option>
              </select>
            </label>
          </div>

          {/* Log table */}
          {logsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin text-gray-400" size={20} />
            </div>
          ) : logs.length === 0 && !logsError ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-400">
              {auditSource === 'production'
                ? 'No production audit logs found.'
                : 'No audit logs found. Run some inference to generate records.'}
            </div>
          ) : !logsError ? (
            <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-8" />
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                      Time
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                      Pipeline
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                      Command
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                      Source
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                      Docs
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                      Spans
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                      Duration
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                      User
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {logs.map((log) => (
                    <LogRow
                      key={log.id}
                      log={log}
                      isSelected={selectedId === log.id}
                      onSelect={() =>
                        setSelectedId(selectedId === log.id ? null : log.id)
                      }
                    />
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
                <button
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                  className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-30"
                >
                  Previous
                </button>
                <span className="text-xs text-gray-400">
                  Page {page + 1} ({logs.length} rows)
                </span>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={logs.length < pageSize}
                  className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Detail panel */}
      {selectedId && (
        <div className="w-80 border-l border-gray-200 bg-white overflow-y-auto">
          <div className="p-4 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">Log Detail</h3>
            {detailLoading ? (
              <Loader2 className="animate-spin text-gray-400" size={16} />
            ) : detail ? (
              <>
                <Field label="ID" value={detail.id} mono />
                <Field label="Timestamp" value={formatTimestamp(detail.timestamp)} />
                <Field label="User" value={detail.user} />
                <Field label="Command" value={detail.command} />
                <Field label="Pipeline" value={detail.pipeline_name} mono />
                <Field label="Source" value={detail.source} />
                <Field label="Documents" value={String(detail.doc_count)} />
                <Field label="Spans Detected" value={String(detail.span_count)} />
                <Field label="Duration" value={formatDuration(detail.duration_seconds)} />
                {detail.error_count > 0 && (
                  <Field label="Errors" value={String(detail.error_count)} />
                )}
                {detail.dataset_source && (
                  <Field label="Dataset" value={detail.dataset_source} />
                )}
                {detail.notes && <Field label="Notes" value={detail.notes} />}
                {Object.keys(detail.metrics).length > 0 && (
                  <div>
                    <span className="text-xs text-gray-500">Metrics</span>
                    <pre className="mt-0.5 rounded bg-gray-50 p-2 text-xs text-gray-700 overflow-x-auto">
                      {JSON.stringify(detail.metrics, null, 2)}
                    </pre>
                  </div>
                )}
                <div>
                  <span className="text-xs text-gray-500">Pipeline Config</span>
                  <pre className="mt-0.5 rounded bg-gray-50 p-2 text-xs text-gray-700 overflow-x-auto max-h-60">
                    {JSON.stringify(detail.pipeline_config, null, 2)}
                  </pre>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function LogRow({
  log,
  isSelected,
  onSelect,
}: {
  log: AuditLogSummary;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <tr
      className={clsx(
        'cursor-pointer transition-colors',
        isSelected ? 'bg-blue-50' : 'hover:bg-gray-50',
      )}
      onClick={onSelect}
    >
      <td className="px-3 py-2 text-gray-400">
        {isSelected ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </td>
      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
        {formatTimestamp(log.timestamp)}
      </td>
      <td className="px-3 py-2 font-mono text-gray-900">{log.pipeline_name}</td>
      <td className="px-3 py-2 text-gray-600">{log.command}</td>
      <td className="px-3 py-2">
        <span
          className={clsx(
            'rounded px-1.5 py-0.5 text-xs font-medium',
            log.source === 'production-api'
              ? 'bg-green-100 text-green-700'
              : log.source === 'api'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-600',
          )}
        >
          {log.source}
        </span>
      </td>
      <td className="px-3 py-2 text-right text-gray-600">{log.doc_count}</td>
      <td className="px-3 py-2 text-right text-gray-600">{log.span_count}</td>
      <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">
        {formatDuration(log.duration_seconds)}
      </td>
      <td className="px-3 py-2 text-gray-500">{log.user}</td>
    </tr>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="text-xs text-gray-500">{label}</span>
      <div className={clsx('text-sm text-gray-900', mono && 'font-mono')}>{value}</div>
    </div>
  );
}
