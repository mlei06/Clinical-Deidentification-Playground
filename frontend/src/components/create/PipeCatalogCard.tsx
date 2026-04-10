import { clsx } from 'clsx';
import { Search, Shuffle, Scissors, AlertCircle } from 'lucide-react';
import type { PipeTypeInfo } from '../../api/types';

const ROLE_ICONS: Record<string, typeof Search> = {
  detector: Search,
  span_transformer: Shuffle,
  redactor: Scissors,
  preprocessor: Shuffle,
};

interface PipeCatalogCardProps {
  pipe: PipeTypeInfo;
}

export default function PipeCatalogCard({ pipe }: PipeCatalogCardProps) {
  const Icon = ROLE_ICONS[pipe.role] ?? Search;

  const onDragStart = (e: React.DragEvent) => {
    if (!pipe.installed) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('application/pipe-type', JSON.stringify(pipe));
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable={pipe.installed}
      onDragStart={onDragStart}
      className={clsx(
        'flex cursor-grab items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-2 text-left shadow-sm transition-colors',
        pipe.installed
          ? 'hover:border-gray-300 hover:shadow active:cursor-grabbing'
          : 'cursor-not-allowed opacity-50',
      )}
      title={pipe.installed ? pipe.description : pipe.install_hint}
    >
      <Icon size={13} className="shrink-0 text-gray-400" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-gray-700">
          {pipe.name.replace(/_/g, ' ')}
        </div>
      </div>
      {!pipe.installed && (
        <AlertCircle size={12} className="shrink-0 text-amber-400" />
      )}
    </div>
  );
}
