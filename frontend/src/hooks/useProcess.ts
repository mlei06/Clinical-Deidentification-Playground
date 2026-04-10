import { useMutation } from '@tanstack/react-query';
import { processText } from '../api/process';
import type { ProcessRequest } from '../api/types';

export function useProcessText() {
  return useMutation({
    mutationFn: ({ pipelineName, req, trace }: {
      pipelineName: string;
      req: ProcessRequest;
      trace?: boolean;
    }) => processText(pipelineName, req, trace),
  });
}
