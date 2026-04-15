import { useMutation } from '@tanstack/react-query';
import { processText, redactDocument } from '../api/process';
import type { OutputMode, ProcessRequest, RedactRequest } from '../api/types';

export function useProcessText() {
  return useMutation({
    mutationFn: ({ pipelineName, req, trace, outputMode }: {
      pipelineName: string;
      req: ProcessRequest;
      trace?: boolean;
      outputMode?: OutputMode;
    }) => processText(pipelineName, req, trace, outputMode),
  });
}

export function useRedactDocument() {
  return useMutation({
    mutationFn: (req: RedactRequest) => redactDocument(req),
  });
}
