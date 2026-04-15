import { apiFetch } from './client';
import type {
  OutputMode,
  ProcessRequest,
  ProcessResponse,
  RedactRequest,
  RedactResponse,
  ScrubRequest,
  ScrubResponse,
} from './types';

export function processText(
  pipelineName: string,
  req: ProcessRequest,
  trace = true,
  outputMode?: OutputMode,
): Promise<ProcessResponse> {
  const params = new URLSearchParams();
  if (trace) params.set('trace', 'true');
  if (outputMode) params.set('output_mode', outputMode);
  const qs = params.toString() ? `?${params}` : '';
  return apiFetch(`/process/${encodeURIComponent(pipelineName)}${qs}`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export function redactDocument(req: RedactRequest): Promise<RedactResponse> {
  return apiFetch('/process/redact', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export function scrubText(req: ScrubRequest): Promise<ScrubResponse> {
  return apiFetch('/process/scrub', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}
