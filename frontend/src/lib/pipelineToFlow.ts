import type { Node, Edge } from '@xyflow/react';
import type { PipelineConfig, PipeTypeInfo } from '../api/types';
import type { PipeNodeData } from '../stores/pipelineEditorStore';

const NODE_GAP = 120;
const NODE_X = 250;

export function pipelineToFlow(
  config: PipelineConfig,
  pipeTypes: PipeTypeInfo[],
): { nodes: Node<PipeNodeData>[]; edges: Edge[] } {
  const catalog = new Map(pipeTypes.map((p) => [p.name, p]));
  const nodes: Node<PipeNodeData>[] = [];
  const edges: Edge[] = [];

  for (let i = 0; i < config.pipes.length; i++) {
    const step = config.pipes[i];
    const info = catalog.get(step.type);
    const nodeId = `pipe-${i}`;

    nodes.push({
      id: nodeId,
      type: 'pipeNode',
      position: { x: NODE_X, y: i * NODE_GAP },
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
    });

    if (i > 0) {
      edges.push({
        id: `edge-${i - 1}-${i}`,
        source: `pipe-${i - 1}`,
        target: nodeId,
        type: 'smoothstep',
      });
    }
  }

  return { nodes, edges };
}
