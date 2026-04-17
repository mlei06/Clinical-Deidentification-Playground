import { useRef, type ReactNode } from 'react';

interface InferenceDualPaneProps {
  left: ReactNode;
  right: ReactNode;
  leftHeader?: ReactNode;
  rightHeader?: ReactNode;
  outputCollapsed?: boolean;
}

/**
 * Synced vertical scroll: annotated source (left) and pipeline output (right).
 * When outputCollapsed, only the left pane is rendered (full width).
 */
export default function InferenceDualPane({
  left,
  right,
  leftHeader,
  rightHeader,
  outputCollapsed = false,
}: InferenceDualPaneProps) {
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
        className={
          outputCollapsed
            ? 'flex min-h-0 min-w-0 flex-1 flex-col'
            : 'flex min-h-0 min-w-0 flex-[0.65] flex-col'
        }
        data-inference-annotate-pane
      >
        <div className="flex min-h-[28px] shrink-0 items-center border-b border-gray-100 bg-gray-50/80 px-2 py-1">
          {leftHeader ?? (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Annotated source
            </span>
          )}
        </div>
        <div
          ref={leftRef}
          onScroll={() => sync('left')}
          className="min-h-0 flex-1 overflow-y-auto p-3"
        >
          {left}
        </div>
      </div>
      {!outputCollapsed && (
        <div className="flex min-h-0 min-w-0 flex-[0.35] flex-col">
          <div className="flex min-h-[28px] shrink-0 items-center border-b border-gray-100 bg-gray-50/80 px-2 py-1">
            {rightHeader ?? (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Output
              </span>
            )}
          </div>
          <div
            ref={rightRef}
            onScroll={() => sync('right')}
            className="min-h-0 flex-1 overflow-y-auto p-3"
          >
            {right}
          </div>
        </div>
      )}
    </div>
  );
}
