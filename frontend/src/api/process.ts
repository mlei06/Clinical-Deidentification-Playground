import { apiFetch } from './client';
import type { ProcessRequest, ProcessResponse } from './types';

export function processText(
  pipelineName: string,
  req: ProcessRequest,
  trace = true,
): Promise<ProcessResponse> {
  const qs = trace ? '?trace=true' : '';
  return apiFetch(`/process/${encodeURIComponent(pipelineName)}${qs}`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}
