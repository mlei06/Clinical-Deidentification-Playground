import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type OnConnect,
  addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import PipeNode from './PipeNode';
import { usePipelineEditorStore } from '../../stores/pipelineEditorStore';
import type { PipeTypeInfo } from '../../api/types';

const nodeTypes = { pipeNode: PipeNode };

export default function PipelineCanvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, addPipe, selectNode } =
    usePipelineEditorStore();

  const setEdges = usePipelineEditorStore((s) => s.onEdgesChange);

  const onConnect: OnConnect = useCallback(
    (connection) => {
      const newEdges = addEdge({ ...connection, type: 'smoothstep' }, usePipelineEditorStore.getState().edges);
      // Compute edge changes
      const currentEdges = usePipelineEditorStore.getState().edges;
      const added = newEdges.filter((e) => !currentEdges.find((ce) => ce.id === e.id));
      if (added.length > 0) {
        setEdges(added.map((e) => ({ type: 'add' as const, item: e })));
      }
    },
    [setEdges],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/pipe-type');
      if (!raw) return;
      try {
        const pipeType: PipeTypeInfo = JSON.parse(raw);
        addPipe(pipeType);
      } catch {
        // ignore invalid drag data
      }
    },
    [addPipe],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      selectNode(node.id);
    },
    [selectNode],
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  return (
    <div className="flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(node) => {
            const role = (node.data as Record<string, unknown>)?.role;
            if (role === 'detector') return '#3b82f6';
            if (role === 'span_transformer') return '#f59e0b';
            if (role === 'redactor') return '#ef4444';
            return '#8b5cf6';
          }}
        />
      </ReactFlow>
    </div>
  );
}
