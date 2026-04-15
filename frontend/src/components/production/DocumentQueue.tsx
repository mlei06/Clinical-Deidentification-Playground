import { useRef, useMemo } from 'react';
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Flag,
  Circle,
  Trash2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useReviewQueue, type QueueDoc, type DocStatus } from './store';

function makeId(name: string): string {
  return `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function parseFile(file: File): Promise<QueueDoc[]> {
  const text = await file.text();
  if (file.name.endsWith('.jsonl')) {
    const out: QueueDoc[] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        const docText = typeof obj.text === 'string'
          ? obj.text
          : typeof obj.document?.text === 'string'
            ? obj.document.text
            : null;
        if (!docText) continue;
        const sourceName = obj.id ?? obj.document?.id ?? `${file.name}#${out.length + 1}`;
        out.push({
          id: makeId(sourceName),
          sourceName,
          text: docText,
          status: 'pending',
          detectedSpans: [],
          editedSpans: [],
          redactedText: '',
        });
      } catch {
        // skip malformed lines
      }
    }
    return out;
  }
  return [
    {
      id: makeId(file.name),
      sourceName: file.name,
      text,
      status: 'pending',
      detectedSpans: [],
      editedSpans: [],
      redactedText: '',
    },
  ];
}

const STATUS_ICONS: Record<DocStatus, typeof Circle> = {
  pending: Circle,
  processing: Loader2,
  ready: FileText,
  reviewed: CheckCircle2,
  flagged: Flag,
  error: AlertTriangle,
};

const STATUS_COLORS: Record<DocStatus, string> = {
  pending: 'text-gray-400',
  processing: 'text-blue-500 animate-spin',
  ready: 'text-gray-700',
  reviewed: 'text-green-600',
  flagged: 'text-amber-600',
  error: 'text-red-600',
};

interface DocumentQueueProps {
  disabled?: boolean;
}

export default function DocumentQueue({ disabled }: DocumentQueueProps) {
  const { docs, currentId, addDocs, setCurrent, removeDoc, clear } = useReviewQueue();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const counts = useMemo(() => {
    const c = { total: docs.length, reviewed: 0, flagged: 0, pending: 0 };
    for (const d of docs) {
      if (d.status === 'reviewed') c.reviewed += 1;
      else if (d.status === 'flagged') c.flagged += 1;
      else c.pending += 1;
    }
    return c;
  }, [docs]);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const parsed: QueueDoc[] = [];
    for (const f of Array.from(files)) {
      parsed.push(...(await parseFile(f)));
    }
    if (parsed.length) addDocs(parsed);
  };

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Queue
        </span>
        <span className="text-[11px] text-gray-400">
          {counts.reviewed}/{counts.total} reviewed
          {counts.flagged > 0 && ` · ${counts.flagged} flagged`}
        </span>
      </div>

      <div className="flex gap-1 border-b border-gray-200 p-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="flex flex-1 items-center justify-center gap-1 rounded bg-gray-900 px-2 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-40"
        >
          <Upload size={12} />
          Upload
        </button>
        {docs.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (confirm('Clear the entire queue? Reviewed work will be lost.')) clear();
            }}
            className="rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
            title="Clear queue"
          >
            <Trash2 size={12} />
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.jsonl,text/plain,application/jsonl"
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <ul className="flex-1 overflow-auto">
        {docs.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-gray-400">
            No documents. Upload <code>.txt</code> or <code>.jsonl</code> files to start.
          </li>
        )}
        {docs.map((d) => {
          const Icon = STATUS_ICONS[d.status];
          const isCurrent = d.id === currentId;
          return (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => setCurrent(d.id)}
                className={clsx(
                  'flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left text-xs transition-colors',
                  isCurrent
                    ? 'border-gray-900 bg-gray-50 text-gray-900'
                    : 'border-transparent text-gray-700 hover:bg-gray-50',
                )}
              >
                <Icon size={13} className={clsx('shrink-0', STATUS_COLORS[d.status])} />
                <span className="min-w-0 flex-1 truncate font-medium">{d.sourceName}</span>
                <span className="shrink-0 text-[10px] text-gray-400">
                  {d.status === 'reviewed'
                    ? `${d.editedSpans.length}✓`
                    : d.status === 'ready'
                      ? `${d.detectedSpans.length}`
                      : d.status === 'processing'
                        ? '…'
                        : d.status === 'error'
                          ? 'err'
                          : ''}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Remove ${d.sourceName}?`)) removeDoc(d.id);
                  }}
                  className="rounded p-0.5 text-gray-300 hover:bg-red-50 hover:text-red-500"
                >
                  <Trash2 size={11} />
                </button>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
