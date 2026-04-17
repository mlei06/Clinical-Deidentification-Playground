import { useRef, type ReactNode } from 'react';

interface InferenceDualPaneProps {
  left: ReactNode;
  right: ReactNode;
}

/**
 * Synced vertical scroll: annotated source (left) and pipeline output (right).
 */
export default function InferenceDualPane({ left, right }: InferenceDualPaneProps) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const sync = (from: 'left' | 'right') => {
    const a = leftRef.current;
    const b = rightRef.current;
    if (!a || !b) return;
    if (syncing.current) return;
    syncing.current = true;
    if (from === 'left') b.scrollTop = a.scrollTop;
    else a.scrollTop = b.scrollTop;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 divide-x divide-gray-200">
      <div
        className="flex min-h-0 min-w-0 flex-[0.65] flex-col"
        data-inference-annotate-pane
      >
        <div className="shrink-0 border-b border-gray-100 bg-gray-50/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Annotated source
        </div>
        <div
          ref={leftRef}
          onScroll={() => sync('left')}
          className="min-h-0 flex-1 overflow-y-auto p-3"
        >
          {left}
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-[0.35] flex-col">
        <div className="shrink-0 border-b border-gray-100 bg-gray-50/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Output
        </div>
        <div
          ref={rightRef}
          onScroll={() => sync('right')}
          className="min-h-0 flex-1 overflow-y-auto p-3"
        >
          {right}
        </div>
      </div>
    </div>
  );
}
