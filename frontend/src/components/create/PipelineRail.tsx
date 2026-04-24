import { useState } from 'react';
import { Plus } from 'lucide-react';
import { usePipelineEditorStore } from '../../stores/pipelineEditorStore';
import type { PipeTypeInfo } from '../../api/types';
import PipeCard from './PipeCard';
import PipeCatalogModal from './PipeCatalogModal';

function FlowConnector() {
  return <div className="h-2 w-px shrink-0 bg-slate-200" aria-hidden />;
}

function StartEndPill({ label }: { label: string }) {
  return (
    <div className="w-full rounded-md border border-dashed border-slate-200 bg-slate-50 py-2.5 text-center text-xs font-medium text-slate-500">
      {label}
    </div>
  );
}

function InsertPipeSlot({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="group relative flex h-8 w-full items-center justify-center">
      <div className="absolute left-1/2 top-0 z-0 h-full w-px -translate-x-1/2 bg-slate-200" aria-hidden />
      <button
        type="button"
        onClick={onOpen}
        className="relative z-10 flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-slate-300 bg-white text-slate-500 opacity-100 shadow-sm transition-all hover:scale-105 hover:border-slate-400 hover:text-slate-700 sm:opacity-0 sm:group-hover:opacity-100"
        title="Insert pipe"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}

export default function PipelineRail() {
  const pipes = usePipelineEditorStore((s) => s.pipes);
  const selectedNodeId = usePipelineEditorStore((s) => s.selectedNodeId);
  const selectNode = usePipelineEditorStore((s) => s.selectNode);
  const removePipe = usePipelineEditorStore((s) => s.removePipe);
  const addPipeAt = usePipelineEditorStore((s) => s.addPipeAt);
  const movePipe = usePipelineEditorStore((s) => s.movePipe);

  const [insertIndex, setInsertIndex] = useState<number | null>(null);

  const handlePick = (p: PipeTypeInfo) => {
    if (insertIndex === null) return;
    addPipeAt(p, insertIndex);
    setInsertIndex(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-50/50">
      <div className="mx-auto flex w-full max-w-[800px] flex-col items-center gap-0 px-3 py-6 sm:px-4">
        <StartEndPill label="Start" />
        <FlowConnector />
        <InsertPipeSlot onOpen={() => setInsertIndex(0)} />

        {pipes.map((entry, index) => (
          <div key={entry.id} className="flex w-full flex-col items-center gap-0">
            <FlowConnector />
            <div className="w-full">
              <PipeCard
                entry={entry}
                index={index}
                isActive={selectedNodeId === entry.id}
                onSelect={selectNode}
                onDelete={removePipe}
                onMove={movePipe}
              />
            </div>
            <FlowConnector />
            <InsertPipeSlot onOpen={() => setInsertIndex(index + 1)} />
          </div>
        ))}

        <FlowConnector />
        <StartEndPill label="End" />
      </div>

      <PipeCatalogModal
        open={insertIndex !== null}
        onClose={() => setInsertIndex(null)}
        onPick={handlePick}
      />
    </div>
  );
}
