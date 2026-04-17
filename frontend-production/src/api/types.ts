export type OutputMode = 'annotated' | 'redacted' | 'surrogate';

export interface PHISpanResponse {
  start: number;
  end: number;
  label: string;
  text: string;
  confidence: number | null;
  source: string | null;
}

export interface ProcessResponse {
  request_id: string;
  original_text: string;
  redacted_text: string;
  spans: PHISpanResponse[];
  pipeline_name: string;
  processing_time_ms: number;
  intermediary_trace: unknown[] | null;
}

export interface BatchProcessResponse {
  results: ProcessResponse[];
  total_processing_time_ms: number;
}

export interface RedactRequest {
  text: string;
  spans: { start: number; end: number; label: string }[];
  output_mode: OutputMode;
  surrogate_seed?: number | null;
  surrogate_consistency?: boolean;
}

export interface RedactResponse {
  output_text: string;
  output_mode: OutputMode;
  span_count: number;
}

export interface ModeInfo {
  name: string;
  pipeline: string;
  description: string;
}

export interface ModesResponse {
  modes: ModeInfo[];
  default_mode: string | null;
}

export interface AuditLogSummary {
  id: string;
  timestamp: string;
  user: string;
  command: string;
  pipeline_name: string;
  source: string;
  doc_count: number;
  span_count: number;
  duration_seconds: number;
}

export interface AuditLogDetail extends AuditLogSummary {
  pipeline_config: Record<string, unknown>;
  dataset_source: string;
  error_count: number;
  metrics: Record<string, unknown>;
  notes: string;
  client_id: string;
  output_mode: string;
  service_type: string;
}

export interface AuditStats {
  total_requests: number;
  avg_duration_seconds: number;
  total_spans_detected: number;
  top_pipelines: { pipeline_name: string; request_count: number }[];
  source_breakdown: Record<string, number>;
}
