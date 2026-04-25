import type { EntitySpanResponse } from '../../api/types';
import { redactDocument } from '../../api/production';
import type { DatasetFile, SavedOutput, SavedOutputMode } from './store';

const LEGACY_HASH_SENTINEL = '__legacy__';

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function hashAnnotations(spans: EntitySpanResponse[]): string {
  const parts = spans
    .map((s) => `${s.start}|${s.end}|${s.label}`)
    .sort();
  return `${parts.length}:${fnv1a(parts.join('\n'))}`;
}

export function hashSourceText(text: string): string {
  return `${text.length}:${fnv1a(text)}`;
}

export function isSavedOutputStale(file: DatasetFile): boolean {
  const out = file.savedOutput;
  if (!out) return false;
  if (out.sourceTextHash === LEGACY_HASH_SENTINEL) return true;
  if (hashSourceText(file.originalText) !== out.sourceTextHash) return true;
  if (hashAnnotations(file.annotations) !== hashAnnotations(out.annotationsAtSave)) return true;
  return false;
}

interface BuildArgs {
  file: DatasetFile;
  mode: SavedOutputMode;
  reviewer: string;
}

export async function buildSavedOutput({
  file,
  mode,
  reviewer,
}: BuildArgs): Promise<SavedOutput> {
  const annotationsAtSave: EntitySpanResponse[] = file.annotations.map((s) => ({ ...s }));
  const sourceTextHash = hashSourceText(file.originalText);
  const savedAt = new Date().toISOString();

  if (mode === 'annotated' || file.annotations.length === 0) {
    return {
      mode,
      text: mode === 'annotated' ? null : file.originalText,
      spans: mode === 'redacted' ? [] : annotationsAtSave.map((s) => ({ ...s })),
      annotationsAtSave,
      sourceTextHash,
      savedAt,
    };
  }

  const apiMode = mode === 'redacted' ? 'redacted' : 'surrogate';
  const res = await redactDocument(
    {
      text: file.originalText,
      spans: file.annotations.map((s) => ({
        start: s.start,
        end: s.end,
        label: s.label,
      })),
      output_mode: apiMode,
      include_surrogate_spans: apiMode === 'surrogate',
      surrogate_consistency: true,
    },
    reviewer || 'production-ui',
  );

  if (mode === 'redacted') {
    return {
      mode,
      text: res.output_text,
      spans: [],
      annotationsAtSave,
      sourceTextHash,
      savedAt,
    };
  }

  // surrogate_annotated
  const surrogateText = res.surrogate_text ?? res.output_text;
  const surrogateSpans = (res.surrogate_spans ?? []).map((s) => ({ ...s }));
  return {
    mode,
    text: surrogateText,
    spans: surrogateSpans,
    annotationsAtSave,
    sourceTextHash,
    savedAt,
  };
}

export interface PreviewBytes {
  text: string;
  spans: EntitySpanResponse[];
  mode: SavedOutputMode;
}

export function previewBytes(file: DatasetFile): PreviewBytes | null {
  const out = file.savedOutput;
  if (!out) return null;
  if (out.mode === 'annotated') {
    return { text: file.originalText, spans: out.spans, mode: 'annotated' };
  }
  if (out.mode === 'redacted') {
    return { text: out.text ?? '', spans: [], mode: 'redacted' };
  }
  return { text: out.text ?? '', spans: out.spans, mode: 'surrogate_annotated' };
}

export const __SAVED_OUTPUT_INTERNAL = { LEGACY_HASH_SENTINEL };
