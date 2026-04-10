import { X, FolderOpen, Trash2 } from 'lucide-react';
import { usePipelines, useDeletePipeline } from '../../hooks/usePipelines';
import { usePipeTypes } from '../../hooks/usePipeTypes';
import { usePipelineEditorStore } from '../../stores/pipelineEditorStore';

interface PipelineLoadDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PipelineLoadDialog({ isOpen, onClose }: PipelineLoadDialogProps) {
  const { data: pipelines } = usePipelines();
  const { data: pipeTypes } = usePipeTypes();
  const deleteMutation = useDeletePipeline();
  const loadFromPipeline = usePipelineEditorStore((s) => s.loadFromPipeline);

  if (!isOpen) return null;

  const handleLoad = (name: string) => {
    const pipeline = pipelines?.find((p) => p.name === name);
    if (!pipeline || !pipeTypes) return;
    loadFromPipeline(pipeline, pipeTypes);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-96 rounded-lg border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <span className="text-sm font-semibold text-gray-900">Load Pipeline</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {!pipelines?.length ? (
            <div className="p-4 text-center text-sm text-gray-400">
              No saved pipelines
            </div>
          ) : (
            pipelines.map((p) => (
              <div
                key={p.name}
                className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-gray-50"
              >
                <button
                  onClick={() => handleLoad(p.name)}
                  className="flex flex-1 items-center gap-2 text-left"
                >
                  <FolderOpen size={14} className="text-gray-400" />
                  <div>
                    <div className="text-sm font-medium text-gray-700">{p.name}</div>
                    <div className="text-[10px] text-gray-400">
                      {p.config.pipes?.length ?? 0} pipes
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${p.name}"?`)) {
                      deleteMutation.mutate(p.name);
                    }
                  }}
                  className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
