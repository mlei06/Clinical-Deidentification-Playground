import { useMemo } from 'react';
import { X, Trash2 } from 'lucide-react';
import { usePipelineEditorStore } from '../../stores/pipelineEditorStore';
import SchemaForm from './SchemaForm';
import type { SchemaFormContext } from './SchemaForm';

export default function PipeConfigPanel() {
  const { nodes, selectedNodeId, updatePipeConfig, removePipe, selectNode } =
    usePipelineEditorStore();

  const node = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId],
  );

  const data = node?.data;

  const formContext: SchemaFormContext = useMemo(
    () => ({
      pipeType: data?.pipeType ?? '',
      baseLabels: data?.baseLabels ?? [],
      config: data?.config ?? {},
    }),
    [data?.pipeType, data?.baseLabels, data?.config],
  );

  if (!node || !data) return null;

  return (
    <div className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-gray-200 bg-white">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-900">{data.label}</div>
          <div className="text-xs text-gray-400">{data.role}</div>
        </div>
        <button
          onClick={() => selectNode(null)}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <X size={16} />
        </button>
      </div>

      {/* Description */}
      {data.description && (
        <div className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
          {data.description}
        </div>
      )}

      {/* Config form */}
      <div className="flex-1 overflow-y-auto p-4">
        {data.configSchema ? (
          <SchemaForm
            schema={data.configSchema}
            formData={data.config}
            onChange={(config) => updatePipeConfig(node.id, config)}
            formContext={formContext}
          />
        ) : (
          <div className="text-xs text-gray-400">No configuration options</div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 p-3">
        <button
          onClick={() => removePipe(node.id)}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
        >
          <Trash2 size={13} />
          Remove Pipe
        </button>
      </div>
    </div>
  );
}
