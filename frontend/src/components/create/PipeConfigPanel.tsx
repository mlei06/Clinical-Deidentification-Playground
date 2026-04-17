import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { X, Trash2, Info } from 'lucide-react';
import { usePipelineEditorStore } from '../../stores/pipelineEditorStore';
import { labelColor } from '../../lib/labelColors';
import SchemaForm from './SchemaForm';
import type { SchemaFormContext } from './schemaFormContext';
import { PipeEditorNodeContext } from './PipeEditorNodeContext';

const MIN_WIDTH = 280;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 320;

function SurrogateStrategies({ strategies }: { strategies: Record<string, string[]> }) {
  return (
    <div className="mt-4 rounded-lg border border-gray-150 bg-gray-50/50 p-3">
      <div className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-gray-700">
        <Info size={12} className="text-gray-400" />
        Supported Labels
      </div>
      <div className="space-y-2">
        {Object.entries(strategies).map(([strategy, labels]) => (
          <div key={strategy}>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
              {strategy}
            </div>
            <div className="flex flex-wrap gap-1">
              {labels.map((lbl) => {
                const c = labelColor(lbl);
                return (
                  <span
                    key={lbl}
                    className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight"
                    style={{ backgroundColor: c.bg, color: c.text }}
                  >
                    {lbl}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2.5 text-[10px] italic text-gray-400">
        Unrecognized labels fall back to *** masking
      </div>
    </div>
  );
}

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
      selectedNodeId: node?.id,
    }),
    [data?.pipeType, data?.baseLabels, data?.config, node?.id],
  );

  const surrogateStrategies = useMemo(() => {
    const raw = (data?.configSchema as Record<string, unknown>)?.ui_surrogate_strategies;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, string[]>;
    }
    return null;
  }, [data?.configSchema]);

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(DEFAULT_WIDTH);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW.current - (e.clientX - startX.current)));
      setWidth(newWidth);
    };
    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  if (!node || !data) return null;

  return (
    <div className="relative flex shrink-0 flex-col overflow-y-auto border-l border-gray-200 bg-white" style={{ width }}>
      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-blue-400/40 active:bg-blue-400/60"
      />
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

      {/* Config form + strategies */}
      <div className="flex-1 overflow-y-auto p-4">
        {data.configSchema ? (
          <PipeEditorNodeContext.Provider value={node.id}>
            <SchemaForm
              schema={data.configSchema}
              formData={data.config}
              onChange={(config) => updatePipeConfig(node.id, config)}
              formContext={formContext}
            />
          </PipeEditorNodeContext.Provider>
        ) : (
          <div className="text-xs text-gray-400">No configuration options</div>
        )}

        {surrogateStrategies && (
          <SurrogateStrategies strategies={surrogateStrategies} />
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
