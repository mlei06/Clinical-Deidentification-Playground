import { apiFetch } from './client';
import type {
  BatchProcessRequest,
  BatchProcessResponse,
  ModesResponse,
  ProcessResponse,
  RedactRequest,
  RedactResponse,
} from './types';

function clientIdHeaders(clientId?: string): Record<string, string> {
  return clientId ? { 'X-Client-Id': clientId } : {};
}

/**
 * Fetch configured inference modes with per-mode availability.
 * Maps to: GET /deploy/health (was /modes on the retired standalone API).
 */
export function getModes(): Promise<ModesResponse> {
  return apiFetch('/deploy/health');
}

/**
 * Run inference on a single text through a mode alias or pipeline name.
 * Maps to: POST /process/{target} (was /infer/{target}).
 */
export function inferText(
  target: string,
  text: string,
  requestId?: string,
  trace = false,
  clientId?: string,
  options?: {
    outputMode?: 'annotated' | 'redacted' | 'surrogate';
    includeSurrogateSpans?: boolean;
    surrogateSeed?: number | null;
  },
): Promise<ProcessResponse> {
  const params = new URLSearchParams();
  if (trace) params.set('trace', 'true');
  if (options?.outputMode) params.set('output_mode', options.outputMode);
  const qs = params.toString() ? `?${params}` : '';
  const body: Record<string, unknown> = { text, request_id: requestId };
  if (options?.includeSurrogateSpans) body.include_surrogate_spans = true;
  if (options?.surrogateSeed != null) body.surrogate_seed = options.surrogateSeed;
  return apiFetch(`/process/${encodeURIComponent(target)}${qs}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: clientIdHeaders(clientId),
  });
}

/**
 * Batch inference for the BatchExport view.
 * Maps to: POST /process/{target}/batch.
 */
export function inferBatch(
  target: string,
  body: BatchProcessRequest,
  clientId?: string,
): Promise<BatchProcessResponse> {
  return apiFetch(`/process/${encodeURIComponent(target)}/batch`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: clientIdHeaders(clientId),
  });
}

/**
 * Apply redaction/surrogate to text with known spans (post-review export).
 * Maps to: POST /process/redact (was /redact).
 */
export function redactDocument(
  req: RedactRequest,
  clientId?: string,
): Promise<RedactResponse> {
  return apiFetch('/process/redact', {
    method: 'POST',
    body: JSON.stringify(req),
    headers: clientIdHeaders(clientId),
  });
}
