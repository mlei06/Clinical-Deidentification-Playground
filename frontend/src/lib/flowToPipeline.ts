import type { Node, Edge } from '@xyflow/react';
import type { PipelineConfig, PipeStep } from '../api/types';
import type { PipeNodeData } from '../stores/pipelineEditorStore';

export function flowToPipeline(
  nodes: Node<PipeNodeData>[],
  edges: Edge[],
): PipelineConfig {
  // Build adjacency: source -> target
  const adj = new Map<string, string>();
  for (const e of edges) {
    adj.set(e.source, e.target);
  }

  // Find root (node with no incoming edge)
  const targets = new Set(edges.map((e) => e.target));
  let rootId = nodes.find((n) => !targets.has(n.id))?.id;

  // Fallback: sort by y position
  if (!rootId && nodes.length > 0) {
    rootId = [...nodes].sort((a, b) => a.position.y - b.position.y)[0].id;
  }

  const ordered: Node<PipeNodeData>[] = [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  if (rootId) {
    let current: string | undefined = rootId;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const node = nodeMap.get(current);
      if (node) ordered.push(node);
      current = adj.get(current);
    }

    // Add any nodes not reachable from root (disconnected)
    for (const n of nodes) {
      if (!visited.has(n.id)) ordered.push(n);
    }
  }

  const pipes: PipeStep[] = ordered.map((n) => {
    const step: PipeStep = { type: n.data.pipeType };
    if (n.data.config && Object.keys(n.data.config).length > 0) {
      step.config = n.data.config;
    }
    return step;
  });

  return { pipes };
}
