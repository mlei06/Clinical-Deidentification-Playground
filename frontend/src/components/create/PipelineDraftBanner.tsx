import { useEffect, useState } from 'react';
import type { PipelineConfig, PipeTypeInfo } from '../../api/types';
import { usePipelineEditorStore } from '../../stores/pipelineEditorStore';

const DRAFT_KEY = 'pipeline-editor-draft';

interface DraftPayload {
  savedAt: number;
  name: string;
  description: string;
  config: PipelineConfig;
}

function readDraft(): DraftPayload | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftPayload;
    if (!parsed?.config?.pipes) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDraft(payload: DraftPayload): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
  } catch {
    /* localStorage may be unavailable / full — silently skip */
  }
}

function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

interface Props {
  pipeTypes: PipeTypeInfo[] | undefined;
}

/**
 * Banner that surfaces a previously-stashed draft on mount, plus an effect
 * that writes the current editor state to localStorage whenever ``isDirty``
 * is set. Cleared as soon as ``isDirty`` flips back to false (save / load /
 * explicit reset).
 */
export default function PipelineDraftBanner({ pipeTypes }: Props) {
  const isDirty = usePipelineEditorStore((s) => s.isDirty);
  const pipelineName = usePipelineEditorStore((s) => s.pipelineName);
  const pipelineDescription = usePipelineEditorStore((s) => s.pipelineDescription);
  const toPipelineConfig = usePipelineEditorStore((s) => s.toPipelineConfig);
  const loadFromPipeline = usePipelineEditorStore((s) => s.loadFromPipeline);

  const [draft, setDraft] = useState<DraftPayload | null>(() => readDraft());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isDirty) {
      clearDraft();
      return;
    }
    const handle = setTimeout(() => {
      writeDraft({
        savedAt: Date.now(),
        name: pipelineName,
        description: pipelineDescription,
        config: toPipelineConfig(),
      });
    }, 500);
    return () => clearTimeout(handle);
  }, [isDirty, pipelineName, pipelineDescription, toPipelineConfig]);

  if (!draft || dismissed || !pipeTypes?.length) return null;
  if (isDirty) return null;

  const when = new Date(draft.savedAt).toLocaleString();

  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
      <span className="font-medium">Unsaved draft from {when}</span>
      {draft.name && <span className="text-amber-700">({draft.name})</span>}
      <div className="flex-1" />
      <button
        onClick={() => {
          loadFromPipeline(
            { name: draft.name, config: draft.config },
            pipeTypes,
          );
          // Loading clears isDirty, which clears the draft via the effect above.
          setDismissed(true);
        }}
        className="rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700"
      >
        Restore
      </button>
      <button
        onClick={() => {
          clearDraft();
          setDismissed(true);
          setDraft(null);
        }}
        className="rounded px-2 py-1 text-xs text-amber-700 hover:bg-amber-100"
      >
        Discard
      </button>
    </div>
  );
}
