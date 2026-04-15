import { useMutation } from '@tanstack/react-query';
import { processText } from '../api/process';
import type { OutputMode, ProcessRequest } from '../api/types';

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
