import { useMemo } from 'react';
import { usePipeTypes } from '../../hooks/usePipeTypes';
import PipeCatalogCard from './PipeCatalogCard';
import type { PipeTypeInfo } from '../../api/types';

const ROLE_ORDER = ['detector', 'span_transformer', 'redactor', 'preprocessor'];
const ROLE_LABELS: Record<string, string> = {
  detector: 'Detectors',
  span_transformer: 'Transformers',
  redactor: 'Redactors',
  preprocessor: 'Preprocessors',
};

export default function PipeCatalogSidebar() {
  const { data: pipeTypes } = usePipeTypes();

  const groups = useMemo(() => {
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
  }, [pipeTypes]);

  return (
    <div className="flex w-52 shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-gray-50 p-3">
      <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Pipe Catalog
      </div>
      {groups.map((g) => (
        <div key={g.role} className="mb-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            {g.label}
          </div>
          <div className="flex flex-col gap-1">
            {g.pipes.map((p) => (
              <PipeCatalogCard key={p.name} pipe={p} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
