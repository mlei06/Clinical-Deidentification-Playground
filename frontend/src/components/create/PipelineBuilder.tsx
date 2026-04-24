import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { Save, FolderOpen, FilePlus2 } from 'lucide-react';
import PipeCatalogSidebar from './PipeCatalogSidebar';
import PipelineCanvas from './PipelineCanvas';
import PipeConfigPanel from './PipeConfigPanel';
import PipelineSaveDialog from './PipelineSaveDialog';
import PipelineLoadDialog from './PipelineLoadDialog';
import { usePipelines } from '../../hooks/usePipelines';
import { usePipeTypes } from '../../hooks/usePipeTypes';
import { usePipelineEditorStore } from '../../stores/pipelineEditorStore';

export default function PipelineBuilder() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const { data: pipelines } = usePipelines();
  const { data: pipeTypes } = usePipeTypes();
  const loadFromPipeline = usePipelineEditorStore((s) => s.loadFromPipeline);
  const { pipelineName, isDirty, nodes, reset } = usePipelineEditorStore();

  const loadName = searchParams.get('load')?.trim() ?? null;
  useEffect(() => {
    if (!loadName || !pipelines?.length || !pipeTypes?.length) return;
    const detail = pipelines.find((p) => p.name === loadName);
    if (!detail) return;
    loadFromPipeline(detail, pipeTypes);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('load');
        return next;
      },
      { replace: true },
    );
  }, [loadName, pipelines, pipeTypes, loadFromPipeline, setSearchParams]);

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-2">
          {pipelineName && (
            <span className="text-sm font-medium text-gray-700">
              {pipelineName}
              {isDirty && <span className="ml-1 text-gray-400">*</span>}
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={() => reset()}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
          >
            <FilePlus2 size={13} />
            New
          </button>
          <button
            onClick={() => setLoadOpen(true)}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
          >
            <FolderOpen size={13} />
            Load
          </button>
          <button
            onClick={() => setSaveOpen(true)}
            disabled={nodes.length === 0}
            className="flex items-center gap-1 rounded bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-40"
          >
            <Save size={13} />
            {pipelineName ? 'Save' : 'Save As'}
          </button>
        </div>

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden">
          <PipeCatalogSidebar />
          <PipelineCanvas />
          <PipeConfigPanel />
        </div>
      </div>

      <PipelineSaveDialog
        isOpen={saveOpen}
        onClose={() => setSaveOpen(false)}
        isUpdate={!!pipelineName}
      />
      <PipelineLoadDialog
        isOpen={loadOpen}
        onClose={() => setLoadOpen(false)}
      />
    </ReactFlowProvider>
  );
}
