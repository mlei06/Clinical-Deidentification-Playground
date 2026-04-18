import { apiFetch } from './client';
import type {
  ModesResponse,
  ProcessResponse,
  RedactRequest,
  RedactResponse,
} from './types';

function clientIdHeaders(clientId?: string): Record<string, string> {
  return clientId ? { 'X-Client-Id': clientId } : {};
}

/**
 * Fetch configured inference modes from the production server.
 * Maps to: GET /modes
 */
export function getModes(): Promise<ModesResponse> {
  return apiFetch('/modes');
}

/**
 * Run inference on a single text through a mode or pipeline.
 * Maps to: POST /infer/{target}
 */
export function inferText(
  target: string,
  text: string,
  requestId?: string,
  trace = false,
  clientId?: string,
): Promise<ProcessResponse> {
  const params = new URLSearchParams();
  if (trace) params.set('trace', 'true');
  const qs = params.toString() ? `?${params}` : '';
  return apiFetch(`/infer/${encodeURIComponent(target)}${qs}`, {
    method: 'POST',
    body: JSON.stringify({ text, request_id: requestId }),
    headers: clientIdHeaders(clientId),
  });
}

/**
 * Apply redaction/surrogate to text with known spans (post-review export).
 * Maps to: POST /redact
 */
export function redactDocument(
  req: RedactRequest,
  clientId?: string,
): Promise<RedactResponse> {
  return apiFetch('/redact', {
    method: 'POST',
    body: JSON.stringify(req),
    headers: clientIdHeaders(clientId),
  });
}
