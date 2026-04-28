import { create } from 'zustand';
import type {
  EntitySpanResponse,
  OutputMode,
  PipelineConfig,
  PipeTypeInfo,
  PipelineDetail,
  TraceFrame,
} from '../api/types';
import { pipelineToSequence, type PipelineSequenceEntry } from '../lib/pipelineToSequence';
import { sequenceToPipelineConfig } from '../lib/flowToPipeline';

export type { PipelineSequenceEntry };

export interface PipeNodeData {
  pipeType: string;
  role: string;
  label: string;
  description: string;
  config: Record<string, unknown>;
  configSchema: Record<string, unknown> | null;
  installed: boolean;
  baseLabels: string[];
  [key: string]: unknown;
}

export interface PipeValidationState {
  errors: string[];
  errorCount: number;
}

export interface PipelineLastRun {
  inputText: string;
  outputText: string;
  spans: EntitySpanResponse[];
  frames: TraceFrame[];
  outputMode: OutputMode;
  totalMs: number;
  runAt: number;
}

interface PipelineEditorState {
  pipes: PipelineSequenceEntry[];
  selectedNodeId: string | null;
  pipelineName: string;
  pipelineDescription: string;
  isDirty: boolean;
  validationByPipeId: Record<string, PipeValidationState>;
  lastRun: PipelineLastRun | null;

  addPipeAt: (pipeType: PipeTypeInfo, index: number) => void;
  removePipe: (id: string) => void;
  movePipe: (fromIndex: number, toIndex: number) => void;
  updatePipeConfig: (id: string, config: Record<string, unknown>) => void;
  selectNode: (id: string | null) => void;
  loadFromPipeline: (detail: PipelineDetail, pipeTypes: PipeTypeInfo[]) => void;
  toPipelineConfig: () => PipelineConfig;
  setPipelineName: (name: string) => void;
  setPipelineDescription: (description: string) => void;
  setPipeValidation: (id: string, state: PipeValidationState) => void;
  clearPipeValidation: (id: string) => void;
  setLastRun: (run: PipelineLastRun | null) => void;
  reset: () => void;
}

let nextId = 0;

function buildData(pipeType: PipeTypeInfo): PipeNodeData {
  return {
    pipeType: pipeType.name,
    role: pipeType.role,
    label: pipeType.name.replace(/_/g, ' '),
    description: pipeType.description,
    config: {},
    configSchema: (pipeType.config_schema as Record<string, unknown>) ?? null,
    installed: pipeType.installed,
    baseLabels: pipeType.base_labels ?? [],
  };
}

function assignSequentialIds(
  raw: ReturnType<typeof pipelineToSequence>,
): PipelineSequenceEntry[] {
  return raw.map((e) => ({
    id: `pipe-${nextId++}`,
    data: e.data,
  }));
}

export const usePipelineEditorStore = create<PipelineEditorState>((set, get) => ({
  pipes: [],
  selectedNodeId: null,
  pipelineName: '',
  pipelineDescription: '',
  isDirty: false,
  validationByPipeId: {},
  lastRun: null,

  addPipeAt: (pipeType, index) => {
    const id = `pipe-${nextId++}`;
    const entry: PipelineSequenceEntry = { id, data: buildData(pipeType) };
    const pipes = [...get().pipes];
    const i = Math.max(0, Math.min(index, pipes.length));
    pipes.splice(i, 0, entry);
    set({ pipes, selectedNodeId: id, isDirty: true, lastRun: null });
  },

  removePipe: (id) => {
    set((s) => {
      const { [id]: _removed, ...validationByPipeId } = s.validationByPipeId;
      return {
        pipes: s.pipes.filter((p) => p.id !== id),
        selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
        validationByPipeId,
        isDirty: true,
        lastRun: null,
      };
    });
  },

  movePipe: (fromIndex, toIndex) => {
    const { pipes: list } = get();
    if (fromIndex < 0 || fromIndex >= list.length) return;
    if (toIndex < 0 || toIndex > list.length - 1) return;
    if (fromIndex === toIndex) return;
    const pipes = [...list];
    const [row] = pipes.splice(fromIndex, 1);
    pipes.splice(toIndex, 0, row);
    set({ pipes, isDirty: true, lastRun: null });
  },

  updatePipeConfig: (id, config) =>
    set((s) => ({
      pipes: s.pipes.map((p) =>
        p.id === id
          ? {
              ...p,
              data: {
                ...p.data,
                config: { ...config },
              },
            }
          : p,
      ),
      isDirty: true,
    })),

  selectNode: (id) => set({ selectedNodeId: id }),

  loadFromPipeline: (detail, pipeTypes) => {
    const raw = pipelineToSequence(detail.config, pipeTypes);
    nextId = 0;
    const pipes = assignSequentialIds(raw);
    nextId = pipes.length;
    set({
      pipes,
      pipelineName: detail.name,
      pipelineDescription: detail.config.description ?? '',
      selectedNodeId: null,
      validationByPipeId: {},
      isDirty: false,
      lastRun: null,
    });
  },

  toPipelineConfig: () => {
    const { pipes, pipelineDescription } = get();
    const trimmed = pipelineDescription.trim();
    return sequenceToPipelineConfig(pipes, trimmed ? { description: trimmed } : undefined);
  },

  setPipelineName: (name) => set({ pipelineName: name }),

  setPipelineDescription: (description) =>
    set((s) => ({ pipelineDescription: description, isDirty: s.isDirty || s.pipelineDescription !== description })),

  setPipeValidation: (id, state) =>
    set((s) => {
      const prev = s.validationByPipeId[id];
      if (
        prev &&
        prev.errorCount === state.errorCount &&
        prev.errors.length === state.errors.length &&
        prev.errors.every((e, i) => e === state.errors[i])
      ) {
        return s;
      }
      return {
        validationByPipeId: { ...s.validationByPipeId, [id]: state },
      };
    }),

  setLastRun: (run) => set({ lastRun: run }),

  clearPipeValidation: (id) =>
    set((s) => {
      if (!(id in s.validationByPipeId)) return s;
      const { [id]: _removed, ...rest } = s.validationByPipeId;
      return { validationByPipeId: rest };
    }),

  reset: () =>
    set({
      pipes: [],
      selectedNodeId: null,
      pipelineName: '',
      pipelineDescription: '',
      validationByPipeId: {},
      isDirty: false,
      lastRun: null,
    }),
}));

export function selectIsPipelineValid(state: {
  pipes: PipelineSequenceEntry[];
  validationByPipeId: Record<string, PipeValidationState>;
}): boolean {
  if (state.pipes.length === 0) return false;
  return state.pipes.every((p) => {
    const v = state.validationByPipeId[p.id];
    return !v || v.errorCount === 0;
  });
}
