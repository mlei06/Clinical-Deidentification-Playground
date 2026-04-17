import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export type InferenceRightTab = 'spans' | 'stats' | 'trace';

interface InferenceRightPanelProps {
  tab: InferenceRightTab;
  onTabChange: (t: InferenceRightTab) => void;
  spansContent: ReactNode;
  statsContent: ReactNode;
  traceContent: ReactNode;
}

const TABS: { id: InferenceRightTab; label: string }[] = [
  { id: 'spans', label: 'Spans' },
  { id: 'stats', label: 'Stats' },
  { id: 'trace', label: 'Trace' },
];

export default function InferenceRightPanel({
  tab,
  onTabChange,
  spansContent,
  statsContent,
  traceContent,
}: InferenceRightPanelProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col border-l border-gray-200 bg-gray-50/90">
      <div className="flex shrink-0 border-b border-gray-200 bg-white">
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
        {tab === 'stats' && statsContent}
        {tab === 'trace' && traceContent}
      </div>
    </div>
  );
}
