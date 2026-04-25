export type OutputMode = 'annotated' | 'redacted' | 'surrogate';

export interface EntitySpanResponse {
  start: number;
  end: number;
  label: string;
  text: string;
  confidence: number | null;
  source: string | null;
}

export interface TraceFrame {
  path: string;
  stage: string;
  pipe_type: string;
  branch_index: number | null;
  extra: Record<string, unknown>;
  document?: {
    document: { id: string; text: string; metadata: Record<string, unknown> };
    spans: { start: number; end: number; label: string; confidence: number | null; source: string | null }[];
  };
  elapsed_ms?: number;
}

export interface ProcessResponse {
  request_id: string;
  original_text: string;
  redacted_text: string;
  spans: EntitySpanResponse[];
  pipeline_name: string;
  processing_time_ms: number;
  intermediary_trace: TraceFrame[] | null;
  /** Present when the caller passes `include_surrogate_spans=true` with `output_mode=surrogate`. */
  surrogate_text?: string | null;
  /** Spans with offsets in `surrogate_text`. Same length / order as `spans`. */
  surrogate_spans?: EntitySpanResponse[] | null;
}

export interface BatchProcessItem {
  text: string;
  request_id?: string;
}

export interface BatchProcessRequest {
  items: BatchProcessItem[];
}

export interface BatchProcessResponse {
  results: ProcessResponse[];
  total_processing_time_ms: number;
}

export interface RedactRequest {
  text: string;
  spans: { start: number; end: number; label: string }[];
  output_mode: OutputMode;
  include_surrogate_spans?: boolean;
  surrogate_seed?: number | null;
  surrogate_consistency?: boolean;
}

export interface RedactResponse {
  output_text: string;
  output_mode: OutputMode;
  span_count: number;
  surrogate_text?: string | null;
  surrogate_spans?: EntitySpanResponse[] | null;
}

export interface ModeInfo {
  name: string;
  pipeline: string;
  description: string;
  /** False when the backing pipeline file is missing or a pipe step has unmet deps. */
  available: boolean;
  /** Tags like ``pipe:foo``, ``model:bar``, or ``pipeline:baz`` explaining why unavailable. */
  missing: string[];
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
