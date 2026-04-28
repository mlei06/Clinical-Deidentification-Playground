import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Save, FolderOpen, FilePlus2, AlertCircle, Braces } from 'lucide-react';
import PipelineRail from './PipelineRail';
import PipeConfigPanel from './PipeConfigPanel';
import PipelineSaveDialog from './PipelineSaveDialog';
import PipelineLoadDialog from './PipelineLoadDialog';
import PipelineJsonDialog from './PipelineJsonDialog';
import PipelineDirtyGuard from './PipelineDirtyGuard';
import PipelineDraftBanner from './PipelineDraftBanner';
import TestPane from './TestPane';
import { usePipelines } from '../../hooks/usePipelines';
import { usePipeTypes } from '../../hooks/usePipeTypes';
import { useValidateAllPipes } from '../../hooks/useValidateAllPipes';
import { usePipelineEditorStore } from '../../stores/pipelineEditorStore';

export default function PipelineBuilder() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const { data: pipelines } = usePipelines();
  const { data: pipeTypes } = usePipeTypes();
  const loadFromPipeline = usePipelineEditorStore((s) => s.loadFromPipeline);
  const setPipelineName = usePipelineEditorStore((s) => s.setPipelineName);
  const setPipelineDescription = usePipelineEditorStore((s) => s.setPipelineDescription);
  const selectNode = usePipelineEditorStore((s) => s.selectNode);
  const pipelineName = usePipelineEditorStore((s) => s.pipelineName);
  const pipelineDescription = usePipelineEditorStore((s) => s.pipelineDescription);
  const isDirty = usePipelineEditorStore((s) => s.isDirty);
  const pipes = usePipelineEditorStore((s) => s.pipes);
  const reset = usePipelineEditorStore((s) => s.reset);
  const validationByPipeId = usePipelineEditorStore((s) => s.validationByPipeId);

  useValidateAllPipes();

  const { invalidCount, firstInvalidId } = useMemo(() => {
    let count = 0;
    let first: string | null = null;
    for (const pipe of pipes) {
      const v = validationByPipeId[pipe.id];
      if (v && v.errorCount > 0) {
        count++;
        if (first === null) first = pipe.id;
      }
    }
    return { invalidCount: count, firstInvalidId: first };
  }, [pipes, validationByPipeId]);

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
    <div className="flex h-full flex-col">
      <PipelineDirtyGuard isDirty={isDirty} />
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={pipelineName}
              onChange={(e) => setPipelineName(e.target.value)}
              placeholder="Untitled pipeline"
              spellCheck={false}
              className="min-w-0 max-w-[28rem] flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-gray-800 placeholder:font-normal placeholder:italic placeholder:text-gray-400 hover:border-gray-200 focus:border-gray-300 focus:bg-white focus:outline-none"
            />
            {isDirty && (
              <span className="text-xs text-gray-400" title="Unsaved changes">
                *
              </span>
            )}
          </div>
          <input
            type="text"
            value={pipelineDescription}
            onChange={(e) => setPipelineDescription(e.target.value)}
            placeholder="Add a description (optional)"
            spellCheck={true}
            className="min-w-0 max-w-[36rem] rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-gray-500 placeholder:italic placeholder:text-gray-300 hover:border-gray-200 focus:border-gray-300 focus:bg-white focus:text-gray-700 focus:outline-none"
          />
        </div>

        {invalidCount > 0 && firstInvalidId && (
          <button
            type="button"
            onClick={() => selectNode(firstInvalidId)}
            className="flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
            title="Jump to first pipe with errors"
          >
            <AlertCircle size={13} />
            {invalidCount} {invalidCount === 1 ? 'issue' : 'issues'}
          </button>
        )}

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
          onClick={() => setJsonOpen(true)}
          disabled={pipes.length === 0}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-40"
          title="Inspect pipeline JSON"
        >
          <Braces size={13} />
          JSON
        </button>
        <button
          onClick={() => setSaveOpen(true)}
          disabled={pipes.length === 0}
          className="flex items-center gap-1 rounded bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-40"
          title={
            pipes.length === 0
              ? 'Add a pipe before saving'
              : invalidCount > 0
                ? `${invalidCount} pipe${invalidCount === 1 ? '' : 's'} with errors`
                : undefined
          }
        >
          <Save size={13} />
          {pipelineName ? 'Save' : 'Save As'}
        </button>
      </div>

      <PipelineDraftBanner pipeTypes={pipeTypes} />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <PipelineRail />
        <PipeConfigPanel />
      </div>

      <TestPane />

      <PipelineSaveDialog
        isOpen={saveOpen}
        onClose={() => setSaveOpen(false)}
        isUpdate={!!pipelineName}
      />
      <PipelineLoadDialog
        isOpen={loadOpen}
        onClose={() => setLoadOpen(false)}
      />
      <PipelineJsonDialog
        isOpen={jsonOpen}
        onClose={() => setJsonOpen(false)}
      />
    </div>
  );
}
