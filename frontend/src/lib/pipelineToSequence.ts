import type { PipelineConfig, PipeTypeInfo } from '../api/types';
import type { PipeNodeData } from '../stores/pipelineEditorStore';

/** One row in the pipeline builder (order = execution order, top to bottom). */
export interface PipelineSequenceEntry {
  id: string;
  data: PipeNodeData;
}

export function pipelineToSequence(
  config: PipelineConfig,
  pipeTypes: PipeTypeInfo[],
): PipelineSequenceEntry[] {
  const catalog = new Map(pipeTypes.map((p) => [p.name, p]));
  return config.pipes.map((step, i) => {
    const info = catalog.get(step.type);
    return {
      id: `pipe-${i}`,
      data: {
        pipeType: step.type,
        role: info?.role ?? 'detector',
        label: step.type.replace(/_/g, ' '),
        description: info?.description ?? '',
        config: step.config ?? {},
        configSchema: (info?.config_schema as Record<string, unknown>) ?? null,
        installed: info?.installed ?? false,
        baseLabels: info?.base_labels ?? [],
      },
    };
  });
}
