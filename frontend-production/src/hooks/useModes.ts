import { useQuery } from '@tanstack/react-query';
import { getModes } from '../api/production';

export function useModes() {
  return useQuery({
    queryKey: ['modes'],
    queryFn: getModes,
  });
}
