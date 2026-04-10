import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { clsx } from 'clsx';
import { Search, Shuffle, Scissors, AlertCircle } from 'lucide-react';
import type { PipeNodeData } from '../../stores/pipelineEditorStore';

const ROLE_STYLES: Record<string, { border: string; bg: string; icon: typeof Search }> = {
  detector:         { border: 'border-l-blue-500',   bg: 'bg-blue-50',   icon: Search },
  span_transformer: { border: 'border-l-amber-500',  bg: 'bg-amber-50',  icon: Shuffle },
  redactor:         { border: 'border-l-red-500',     bg: 'bg-red-50',    icon: Scissors },
  preprocessor:     { border: 'border-l-violet-500',  bg: 'bg-violet-50', icon: Shuffle },
};

function PipeNode({ data, selected }: NodeProps & { data: PipeNodeData }) {
  const style = ROLE_STYLES[data.role] ?? ROLE_STYLES.detector;
  const Icon = style.icon;

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />
      <div
        className={clsx(
          'flex w-56 items-center gap-2 rounded-lg border border-l-4 bg-white px-3 py-2.5 shadow-sm transition-shadow',
          style.border,
          selected && 'ring-2 ring-gray-900 ring-offset-1',
          !data.installed && 'opacity-60',
        )}
      >
        <div className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded', style.bg)}>
          <Icon size={14} className="text-gray-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-gray-800">
            {data.label}
          </div>
          <div className="truncate text-[10px] text-gray-400">{data.role}</div>
        </div>
        {!data.installed && (
          <AlertCircle size={14} className="shrink-0 text-amber-500" />
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
    </>
  );
}

export default memo(PipeNode);
