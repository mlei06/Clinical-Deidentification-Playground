import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export type InferenceRightTab = 'spans' | 'pipeline';

interface InferenceRightPanelProps {
  tab: InferenceRightTab;
  onTabChange: (t: InferenceRightTab) => void;
  spansContent: ReactNode;
  pipelineContent: ReactNode;
  /** If provided, renders a collapse button in the tabs row. */
  onCollapse?: () => void;
}

const TABS: { id: InferenceRightTab; label: string }[] = [
  { id: 'spans', label: 'Spans' },
  { id: 'pipeline', label: 'Pipeline' },
];

export default function InferenceRightPanel({
  tab,
  onTabChange,
  spansContent,
  pipelineContent,
  onCollapse,
}: InferenceRightPanelProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col border-l border-gray-200 bg-gray-50/90">
      <div className="flex shrink-0 items-stretch border-b border-gray-200 bg-white">
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="flex shrink-0 items-center border-r border-gray-100 px-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700"
            title="Collapse side panel"
            aria-label="Collapse side panel"
          >
            <ChevronRight size={14} />
          </button>
        )}
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            className={clsx(
              'flex-1 border-b-2 px-2 py-2 text-center text-[11px] font-semibold transition-colors',
              tab === id
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-800',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tab === 'spans' && spansContent}
        {tab === 'pipeline' && pipelineContent}
      </div>
    </div>
  );
}
