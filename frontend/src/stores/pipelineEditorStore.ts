import { create } from 'zustand';
import type { Node, Edge, OnNodesChange, OnEdgesChange } from '@xyflow/react';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { PipeTypeInfo, PipelineDetail } from '../api/types';
import { pipelineToFlow } from '../lib/pipelineToFlow';
import { flowToPipeline } from '../lib/flowToPipeline';

export interface PipeNodeData {
  pipeType: string;
  role: string;
  label: string;
  description: string;
  config: Record<string, unknown>;
  configSchema: Record<string, unknown> | null;
  installed: boolean;
  baseLabels: string[];
  [key: string]: unknown;
}

interface PipelineEditorState {
  nodes: Node<PipeNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  pipelineName: string;
  pipelineDescription: string;
  isDirty: boolean;

  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  addPipe: (pipeType: PipeTypeInfo, afterNodeId?: string) => void;
  removePipe: (nodeId: string) => void;
  updatePipeConfig: (nodeId: string, config: Record<string, unknown>) => void;
  selectNode: (nodeId: string | null) => void;
  loadFromPipeline: (detail: PipelineDetail, pipeTypes: PipeTypeInfo[]) => void;
  toPipelineConfig: () => ReturnType<typeof flowToPipeline>;
  setPipelineName: (name: string) => void;
  setPipelineDescription: (description: string) => void;
  reset: () => void;
}

let nextId = 0;

export const usePipelineEditorStore = create<PipelineEditorState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  pipelineName: '',
  pipelineDescription: '',
  isDirty: false,

  onNodesChange: (changes) =>
    set((s) => ({
      nodes: applyNodeChanges(changes, s.nodes) as Node<PipeNodeData>[],
      isDirty: true,
    })),

  onEdgesChange: (changes) =>
    set((s) => ({
      edges: applyEdgeChanges(changes, s.edges),
      isDirty: true,
    })),

  addPipe: (pipeType, afterNodeId) => {
    const id = `pipe-${nextId++}`;
    const { nodes, edges } = get();

    // Determine Y position
    let y = 0;
    let insertAfterIdx = -1;
    if (afterNodeId) {
      insertAfterIdx = nodes.findIndex((n) => n.id === afterNodeId);
    }
    if (nodes.length > 0) {
      const refNode = insertAfterIdx >= 0 ? nodes[insertAfterIdx] : nodes[nodes.length - 1];
      y = refNode.position.y + 120;
    }

    const newNode: Node<PipeNodeData> = {
      id,
      type: 'pipeNode',
      position: { x: 250, y },
      data: {
        pipeType: pipeType.name,
        role: pipeType.role,
        label: pipeType.name.replace(/_/g, ' '),
        description: pipeType.description,
        config: {},
        configSchema: (pipeType.config_schema as Record<string, unknown>) ?? null,
        installed: pipeType.installed,
        baseLabels: pipeType.base_labels ?? [],
      },
    };

    // Auto-connect to last node
    const newEdges = [...edges];
    if (nodes.length > 0) {
      const lastNode = nodes[nodes.length - 1];
      newEdges.push({
        id: `edge-${lastNode.id}-${id}`,
        source: lastNode.id,
        target: id,
        type: 'smoothstep',
      });
    }

    set({
      nodes: [...nodes, newNode],
      edges: newEdges,
      selectedNodeId: id,
      isDirty: true,
    });
  },

  removePipe: (nodeId) => {
    const { nodes, edges } = get();
    const inEdge = edges.find((e) => e.target === nodeId);
    const outEdge = edges.find((e) => e.source === nodeId);

    let newEdges = edges.filter((e) => e.source !== nodeId && e.target !== nodeId);

    // Reconnect neighbors
    if (inEdge && outEdge) {
      newEdges.push({
        id: `edge-${inEdge.source}-${outEdge.target}`,
        source: inEdge.source,
        target: outEdge.target,
        type: 'smoothstep',
      });
    }

    set({
      nodes: nodes.filter((n) => n.id !== nodeId),
      edges: newEdges,
      selectedNodeId: null,
      isDirty: true,
    });
  },

  updatePipeConfig: (nodeId, config) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                // Shallow clone: @rjsf/core often mutates formData in place, so keeping the same
                // reference breaks useMemo deps and label-space queries when e.g. model changes.
                config: { ...config },
              },
            }
          : n,
      ),
      isDirty: true,
    })),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  loadFromPipeline: (detail, pipeTypes) => {
    const { nodes, edges } = pipelineToFlow(detail.config, pipeTypes);
    nextId = nodes.length;
    set({
      nodes,
      edges,
      pipelineName: detail.name,
      pipelineDescription: detail.config.description ?? '',
      selectedNodeId: null,
      isDirty: false,
    });
  },

  toPipelineConfig: () => {
    const { nodes, edges, pipelineDescription } = get();
    const config = flowToPipeline(nodes, edges);
    const trimmed = pipelineDescription.trim();
    return trimmed ? { ...config, description: trimmed } : config;
  },

  setPipelineName: (name) => set({ pipelineName: name }),

  setPipelineDescription: (description) =>
    set((s) => ({ pipelineDescription: description, isDirty: s.isDirty || s.pipelineDescription !== description })),

  reset: () =>
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      pipelineName: '',
      pipelineDescription: '',
      isDirty: false,
    }),
}));
