import { useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { useProductionStore } from '../../components/production/store';

export default function GlobalSettingsPopover() {
  const reviewer = useProductionStore((s) => s.reviewer);
  const setReviewer = useProductionStore((s) => s.setReviewer);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Global settings"
      >
        <Settings size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded border border-gray-200 bg-white p-3 shadow-lg">
          <h3 className="mb-2 text-xs font-semibold text-gray-800">Global settings</h3>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-gray-600">
            Reviewer
            <input
              type="text"
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              placeholder="Your name or ID"
              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 focus:border-blue-400 focus:outline-none"
            />
          </label>
          <p className="mt-2 text-[10px] text-gray-500">
            Saved automatically. Used as the X-Client-Id and recorded in export metadata.
          </p>
        </div>
      )}
    </div>
  );
}
