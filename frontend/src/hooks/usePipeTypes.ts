import { useQuery } from '@tanstack/react-query';
import { listPipeTypes } from '../api/pipelines';

export function usePipeTypes() {
  return useQuery({
    queryKey: ['pipe-types'],
    queryFn: listPipeTypes,
    staleTime: 5 * 60 * 1000,
  });
}
