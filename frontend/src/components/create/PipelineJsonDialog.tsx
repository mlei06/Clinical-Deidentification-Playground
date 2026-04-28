import { useMemo, useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { usePipelineEditorStore } from '../../stores/pipelineEditorStore';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function PipelineJsonDialog({ isOpen, onClose }: Props) {
  const toPipelineConfig = usePipelineEditorStore((s) => s.toPipelineConfig);
  const [copied, setCopied] = useState(false);

  const json = useMemo(() => {
    if (!isOpen) return '';
    try {
      return JSON.stringify(toPipelineConfig(), null, 2);
    } catch (e) {
      return `// failed to serialize: ${(e as Error).message}`;
    }
  }, [isOpen, toPipelineConfig]);

  if (!isOpen) return null;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="flex max-h-[min(80vh,720px)] w-full max-w-2xl flex-col rounded-lg border border-gray-200 bg-white shadow-xl"
        role="dialog"
        aria-label="Pipeline JSON"
      >
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
          <span className="text-sm font-semibold text-gray-900">Pipeline JSON</span>
          <span className="text-xs text-gray-400">read-only</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onCopy}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={16} />
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto bg-slate-50 px-4 py-3 font-mono text-xs leading-relaxed text-slate-800">
          {json}
        </pre>
      </div>
    </div>
  );
}
