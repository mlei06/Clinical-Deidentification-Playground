import { apiFetch } from './client';
import type {
  OutputMode,
  PipelineConfig,
  ProcessRequest,
  ProcessResponse,
  RedactRequest,
  RedactResponse,
  ScrubRequest,
  ScrubResponse,
} from './types';

function clientIdHeaders(clientId?: string): Record<string, string> {
  return clientId ? { 'X-Client-Id': clientId } : {};
}

export interface PreviewProcessRequest {
  text: string;
  config: PipelineConfig;
  request_id?: string;
}

export function processPreview(
  req: PreviewProcessRequest,
  outputMode: OutputMode = 'annotated',
): Promise<ProcessResponse> {
  const params = new URLSearchParams();
  params.set('output_mode', outputMode);
  return apiFetch(`/process/preview?${params.toString()}`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export function processText(
  pipelineName: string,
  req: ProcessRequest,
  trace = true,
  outputMode?: OutputMode,
  clientId?: string,
): Promise<ProcessResponse> {
  const params = new URLSearchParams();
  if (trace) params.set('trace', 'true');
  if (outputMode) params.set('output_mode', outputMode);
  const qs = params.toString() ? `?${params}` : '';
  return apiFetch(`/process/${encodeURIComponent(pipelineName)}${qs}`, {
    method: 'POST',
    body: JSON.stringify(req),
    headers: clientIdHeaders(clientId),
  });
}

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

export function scrubText(req: ScrubRequest, clientId?: string): Promise<ScrubResponse> {
  return apiFetch('/process/scrub', {
    method: 'POST',
    body: JSON.stringify(req),
    headers: clientIdHeaders(clientId),
  });
}
