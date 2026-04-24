import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface PasteModalProps {
  onClose: () => void;
  onSubmit: (title: string, text: string) => void;
}

export default function PasteModal({ onClose, onSubmit }: PasteModalProps) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-[640px] max-w-[90vw] flex-col rounded-lg border border-gray-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
          <h2 className="text-sm font-semibold text-gray-900">Paste text</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100"
          >
            <X size={14} />
          </button>
        </header>
        <div className="flex flex-col gap-2 p-4">
          <label className="text-xs font-medium text-gray-600">
            Title (optional)
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Progress note 2024-03-14"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-gray-600">
            Text
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={14}
              placeholder="Paste clinical text here…"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 font-mono text-sm"
            />
          </label>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(title, text)}
            disabled={!text.trim()}
            className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-40"
          >
            Add file
          </button>
        </footer>
      </div>
    </div>
  );
}
