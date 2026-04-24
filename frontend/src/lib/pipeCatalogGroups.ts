import type { PipeTypeInfo } from '../api/types';

const ROLE_ORDER = ['detector', 'span_transformer', 'preprocessor'];
const ROLE_LABELS: Record<string, string> = {
  detector: 'Detectors',
  span_transformer: 'Transformers',
  preprocessor: 'Preprocessors',
};

export type PipeCatalogGroup = { role: string; label: string; pipes: PipeTypeInfo[] };

export function buildPipeCatalogGroups(pipeTypes: PipeTypeInfo[] | undefined): PipeCatalogGroup[] {
  if (!pipeTypes) return [];
  const activePipes = pipeTypes.filter((p) => !p.deprecated);
  const map = new Map<string, PipeTypeInfo[]>();
  for (const p of activePipes) {
    const list = map.get(p.role) ?? [];
    list.push(p);
    map.set(p.role, list);
  }
  return ROLE_ORDER.filter((r) => map.has(r)).map((r) => ({
    role: r,
    label: ROLE_LABELS[r] ?? r,
    pipes: map.get(r)!,
  }));
}
