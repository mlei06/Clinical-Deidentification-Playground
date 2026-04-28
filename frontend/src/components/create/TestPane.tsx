import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Play, Loader2, AlertCircle } from 'lucide-react';
import { processPreview } from '../../api/process';
import type { OutputMode, ProcessResponse } from '../../api/types';
import { usePipelineEditorStore } from '../../stores/pipelineEditorStore';
import SpanHighlighter from '../shared/SpanHighlighter';

const HEIGHT_KEY = 'pipeline-test-pane-height';
const TEXT_KEY = 'pipeline-test-pane-text';
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 280;

const SAMPLE_TEXT =
  'Patient John Doe (MRN 123-45-6789) was seen on 2024-03-15. ' +
  'Phone: (555) 123-4567. Email: john.doe@example.com.';

function readStoredHeight(): number {
  try {
    const raw = localStorage.getItem(HEIGHT_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(n) && n >= MIN_HEIGHT && n <= MAX_HEIGHT) return n;
  } catch {
    /* ignore */
  }
  return DEFAULT_HEIGHT;
}

function readStoredText(): string {
  try {
    return localStorage.getItem(TEXT_KEY) ?? SAMPLE_TEXT;
  } catch {
    return SAMPLE_TEXT;
  }
}

const OUTPUT_MODES: { value: OutputMode; label: string }[] = [
  { value: 'annotated', label: 'Annotated' },
  { value: 'redacted', label: 'Redacted' },
  { value: 'surrogate', label: 'Surrogate' },
];

export default function TestPane() {
  const pipes = usePipelineEditorStore((s) => s.pipes);
  const toPipelineConfig = usePipelineEditorStore((s) => s.toPipelineConfig);
  const setLastRun = usePipelineEditorStore((s) => s.setLastRun);
  const lastRun = usePipelineEditorStore((s) => s.lastRun);

  const [collapsed, setCollapsed] = useState(true);
  const [height, setHeight] = useState<number>(() => readStoredHeight());
  const [text, setText] = useState<string>(() => readStoredText());
  const [outputMode, setOutputMode] = useState<OutputMode>('annotated');

  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(DEFAULT_HEIGHT);

  useEffect(() => {
    try {
      localStorage.setItem(HEIGHT_KEY, String(height));
    } catch {
      /* ignore */
    }
  }, [height]);

  useEffect(() => {
    try {
      localStorage.setItem(TEXT_KEY, text);
    } catch {
      /* ignore */
    }
  }, [text]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startH.current = height;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [height],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const next = Math.min(
        MAX_HEIGHT,
        Math.max(MIN_HEIGHT, startH.current - (e.clientY - startY.current)),
      );
      setHeight(next);
    };
    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const mutation = useMutation<ProcessResponse, Error, OutputMode>({
    mutationFn: (mode: OutputMode) =>
      processPreview({ text, config: toPipelineConfig() }, mode),
    onSuccess: (resp, mode) => {
      setLastRun({
        inputText: resp.original_text,
        outputText: resp.redacted_text,
        spans: resp.spans,
        frames: resp.intermediary_trace ?? [],
        outputMode: mode,
        totalMs: resp.processing_time_ms,
        runAt: Date.now(),
      });
    },
  });

  const runDisabled = pipes.length === 0 || !text.trim() || mutation.isPending;

  const handleRun = () => {
    if (runDisabled) return;
    mutation.mutate(outputMode);
  };

  const showSpans = useMemo(() => {
    if (!lastRun) return null;
    if (lastRun.outputMode === 'redacted') return null;
    return lastRun.spans;
  }, [lastRun]);

  const displayText =
    lastRun?.outputMode === 'redacted' ? lastRun.outputText : lastRun?.inputText ?? '';

  return (
    <div className="border-t border-gray-200 bg-white shadow-[0_-2px_6px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2 px-4 py-2">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Test
          {lastRun && (
            <span className="ml-1 rounded bg-gray-100 px-1.5 text-[10px] font-medium text-gray-600">
              {lastRun.spans.length} spans · {lastRun.totalMs.toFixed(1)}ms
            </span>
          )}
        </button>
        <div className="flex-1" />
        {!collapsed && (
          <select
            value={outputMode}
            onChange={(e) => setOutputMode(e.target.value as OutputMode)}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
          >
            {OUTPUT_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={handleRun}
          disabled={runDisabled}
          className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          title={
            pipes.length === 0
              ? 'Add a pipe first'
              : !text.trim()
                ? 'Enter sample text'
                : undefined
          }
        >
          {mutation.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Play size={13} />
          )}
          Run
        </button>
      </div>

      {!collapsed && (
        <>
          <div
            onMouseDown={onMouseDown}
            className="h-1 cursor-row-resize bg-gray-100 hover:bg-blue-400/40"
            title="Drag to resize"
          />
          <div
            className="grid grid-cols-2 gap-3 overflow-hidden px-4 py-3"
            style={{ height }}
          >
            <div className="flex min-h-0 flex-col">
              <label className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                Input
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                className="flex-1 resize-none rounded border border-gray-300 px-3 py-2 font-mono text-xs leading-relaxed focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                placeholder="Paste sample text and click Run."
              />
            </div>
            <div className="flex min-h-0 flex-col">
              <label className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                Output
                {lastRun && (
                  <span className="font-normal normal-case text-gray-400">
                    ({lastRun.outputMode})
                  </span>
                )}
              </label>
              <div className="flex-1 overflow-auto rounded border border-gray-200 bg-slate-50/40 px-3 py-2 font-mono text-xs leading-relaxed">
                {mutation.isError ? (
                  <div className="flex items-start gap-1.5 text-red-600">
                    <AlertCircle size={13} className="mt-0.5 shrink-0" />
                    <span className="break-words">
                      {(mutation.error as Error).message}
                    </span>
                  </div>
                ) : !lastRun ? (
                  <div className="text-gray-400">Run the pipeline to see output.</div>
                ) : showSpans ? (
                  <SpanHighlighter text={displayText} spans={showSpans} />
                ) : (
                  <pre className="whitespace-pre-wrap break-words">{displayText}</pre>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
