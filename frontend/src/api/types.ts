/* ------------------------------------------------------------------ */
/* Mirrors of backend Pydantic schemas                                */
/* ------------------------------------------------------------------ */

// Domain
export interface PHISpanResponse {
  start: number;
  end: number;
  label: string;
  text: string;
  confidence: number | null;
  source: string | null;
}

export interface ProcessRequest {
  text: string;
  request_id?: string;
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
  spans: PHISpanResponse[];
  pipeline_name: string;
  processing_time_ms: number;
  intermediary_trace: TraceFrame[] | null;
}

export interface SavedInferenceRunSummary {
  id: string;
  pipeline_name: string;
  saved_at: string;
  text_preview: string;
  span_count: number;
}

export interface SavedInferenceRunDetail extends ProcessResponse {
  id: string;
  saved_at: string;
}

// Pipelines
export interface PipeStep {
  type: string;
  config?: Record<string, unknown>;
}

export interface PipelineConfig {
  pipes: PipeStep[];
}

export interface PipelineDetail {
  name: string;
  config: PipelineConfig;
}

export interface CreatePipelineRequest {
  name: string;
  config: PipelineConfig;
}

export interface PipeTypeInfo {
  name: string;
  description: string;
  role: string;
  extra: string | null;
  install_hint: string;
  installed: boolean;
  config_schema: Record<string, unknown> | null;
  base_labels: string[] | null;
  deprecated?: boolean;
}

export interface ValidatePipelineResponse {
  valid: boolean;
  error: string | null;
}

// Evaluation
export interface MatchMetrics {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
}

export interface EvalRunRequest {
  pipeline_name: string;
  dataset_path: string;
  dataset_format: 'jsonl' | 'brat-dir' | 'brat-corpus';
}

export interface EvalRunSummary {
  id: string;
  pipeline_name: string;
  dataset_source: string;
  document_count: number;
  strict_f1: number;
  risk_weighted_recall: number;
  created_at: string;
}

export interface LabelMetricsDetail {
  strict: MatchMetrics;
  partial_overlap: MatchMetrics;
  token_level: MatchMetrics;
  support: number;
}

export interface EvalRunDetail extends EvalRunSummary {
  metrics: {
    overall: Record<string, MatchMetrics>;
    per_label: Record<string, LabelMetricsDetail>;
    risk_weighted_recall: number;
    label_confusion: Record<string, Record<string, number>>;
  };
}

export interface EvalCompareResponse {
  run_a: EvalRunDetail;
  run_b: EvalRunDetail;
  delta_strict_f1: number;
  delta_risk_weighted_recall: number;
}

// Dictionaries
export interface DictionaryInfo {
  kind: 'whitelist' | 'blacklist';
  label: string | null;
  name: string;
  filename: string;
  term_count: number;
}

export interface DictionaryPreview {
  kind: string;
  label: string | null;
  name: string;
  term_count: number;
  sample_terms: string[];
  file_size_bytes: number;
}

export interface DictionaryTermsPage {
  terms: string[];
  total: number;
  offset: number;
  limit: number;
  search: string | null;
}

export interface DictionaryUploadResult {
  info: DictionaryInfo;
  message: string;
}
