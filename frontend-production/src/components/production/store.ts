import { useEffect, useState } from 'react';
import { create } from 'zustand';
import {
  persist,
  createJSONStorage,
  type PersistOptions,
} from 'zustand/middleware';
import type { EntitySpanResponse } from '../../api/types';
import { makeIdbStorage } from '../../lib/idbStorage';

export type ExportOutputType = 'redacted' | 'annotated' | 'surrogate_annotated';

export type DetectionStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'error';

export interface DatasetFile {
  id: string;
  sourceLabel: string;
  originalText: string;
  annotations: EntitySpanResponse[];
  detectedAt?: EntitySpanResponse[] | null;
  detectionStatus: DetectionStatus;
  lastDetectionTarget?: string;
  resolved: boolean;
  flagged?: boolean;
  note?: string;
  error?: string;
  processingTimeMs?: number;
  surrogateText?: string | null;
  annotationsOnSurrogate?: EntitySpanResponse[] | null;
  createdAt: string;
}

export interface Dataset {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  defaultDetectionMode: string;
  exportOutputType: ExportOutputType;
  files: DatasetFile[];
  currentFileId: string | null;
}

interface UiState {
  reviewer: string;
  lastExportScope: 'all' | 'resolved';
}

interface State extends UiState {
  activeDatasetId: string | null;
  datasets: Record<string, Dataset>;

  setReviewer: (name: string) => void;
  setLastExportScope: (scope: 'all' | 'resolved') => void;

  createDataset: (name: string, seed?: Partial<Dataset>) => string;
  renameDataset: (id: string, name: string) => void;
  deleteDataset: (id: string) => void;
  setActiveDataset: (id: string | null) => void;
  duplicateDataset: (id: string, newName: string) => string | null;

  setDatasetExportType: (id: string, t: ExportOutputType) => void;
  setDatasetDefaultMode: (id: string, mode: string) => void;

  addFiles: (datasetId: string, files: DatasetFile[]) => void;
  removeFile: (datasetId: string, fileId: string) => void;
  clearFiles: (datasetId: string) => void;
  updateFile: (datasetId: string, fileId: string, patch: Partial<DatasetFile>) => void;
  setFileResolved: (datasetId: string, fileId: string, resolved: boolean) => void;
  setCurrentFile: (datasetId: string, fileId: string | null) => void;

  replaceFileAnnotations: (
    datasetId: string,
    fileId: string,
    spans: EntitySpanResponse[],
    opts: {
      target: string;
      processingTimeMs?: number;
      clearResolved: boolean;
      surrogateText?: string | null;
      annotationsOnSurrogate?: EntitySpanResponse[] | null;
    },
  ) => void;
}

export const DEFAULT_EXPORT_TYPE: ExportOutputType = 'annotated';

export function makeId(stem: string): string {
  const safe = stem.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 48) || 'id';
  return `${safe}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newDataset(name: string, seed?: Partial<Dataset>): Dataset {
  const id = seed?.id ?? makeId('ds');
  const t = nowIso();
  return {
    id,
    name,
    createdAt: seed?.createdAt ?? t,
    updatedAt: t,
    defaultDetectionMode: seed?.defaultDetectionMode ?? '',
    exportOutputType: seed?.exportOutputType ?? DEFAULT_EXPORT_TYPE,
    files: seed?.files ?? [],
    currentFileId: seed?.currentFileId ?? null,
  };
}

interface LegacyDoc {
  id?: string;
  sourceName?: string;
  text?: string;
  status?: string;
  detectedSpans?: EntitySpanResponse[];
  editedSpans?: EntitySpanResponse[];
  redactedText?: string;
  note?: string;
  processingTimeMs?: number;
  error?: string;
  reviewedAt?: string;
}

interface PersistedShape {
  reviewer?: string;
  lastExportScope?: 'all' | 'resolved';
  activeDatasetId?: string | null;
  datasets?: Record<string, Dataset>;
}

function migrateLegacyQueue(legacy: {
  reviewer?: string;
  mode?: string;
  docs?: LegacyDoc[];
}): PersistedShape {
  const files: DatasetFile[] = (legacy.docs ?? []).map((d, i): DatasetFile => {
    const sourceLabel = d.sourceName ?? `legacy-${i + 1}`;
    const spans = d.editedSpans ?? d.detectedSpans ?? [];
    const resolved = d.status === 'reviewed';
    const status: DetectionStatus =
      d.status === 'processing'
        ? 'processing'
        : d.status === 'error'
          ? 'error'
          : d.status === 'pending' || d.status === undefined
            ? 'pending'
            : 'ready';
    return {
      id: d.id ?? makeId(sourceLabel),
      sourceLabel,
      originalText: d.text ?? '',
      annotations: spans,
      detectedAt: d.detectedSpans ?? null,
      detectionStatus: status,
      resolved,
      flagged: d.status === 'flagged',
      note: d.note,
      error: d.error,
      processingTimeMs: d.processingTimeMs,
      createdAt: nowIso(),
    };
  });
  const dataset = newDataset('Legacy import', {
    defaultDetectionMode: legacy.mode ?? '',
    exportOutputType: DEFAULT_EXPORT_TYPE,
    files,
    currentFileId: files[0]?.id ?? null,
  });
  return {
    reviewer: legacy.reviewer ?? '',
    lastExportScope: 'resolved',
    activeDatasetId: dataset.id,
    datasets: { [dataset.id]: dataset },
  };
}

const PERSIST_VERSION = 2;
const PERSIST_KEY = 'clinical-deid-production:v2';

let _storage: ReturnType<typeof makeIdbStorage> | null = null;
function makeIdbStorageSingleton() {
  if (!_storage) _storage = makeIdbStorage('clinical-deid-production');
  return _storage;
}

const persistOptions: PersistOptions<State, PersistedShape> = {
  name: PERSIST_KEY,
  version: PERSIST_VERSION,
  storage: createJSONStorage(() => makeIdbStorageSingleton()),
  partialize: (s): PersistedShape => ({
    reviewer: s.reviewer,
    lastExportScope: s.lastExportScope,
    activeDatasetId: s.activeDatasetId,
    datasets: s.datasets,
  }),
  migrate: (persisted, version): PersistedShape => {
    if (persisted == null) return {};
    if (version >= PERSIST_VERSION) return persisted as PersistedShape;
    const legacy = persisted as {
      reviewer?: string;
      mode?: string;
      docs?: LegacyDoc[];
    };
    if (Array.isArray(legacy.docs)) return migrateLegacyQueue(legacy);
    return persisted as PersistedShape;
  },
};

export const useProductionStore = create<State>()(
  persist(
    (set, get) => ({
      reviewer: '',
      lastExportScope: 'resolved',
      activeDatasetId: null,
      datasets: {},

      setReviewer: (name) => set({ reviewer: name }),
      setLastExportScope: (scope) => set({ lastExportScope: scope }),

      createDataset: (name, seed) => {
        const ds = newDataset(name, seed);
        set((s) => ({
          datasets: { ...s.datasets, [ds.id]: ds },
          activeDatasetId: s.activeDatasetId ?? ds.id,
        }));
        return ds.id;
      },

      renameDataset: (id, name) =>
        set((s) => {
          const ds = s.datasets[id];
          if (!ds) return s;
          return {
            datasets: {
              ...s.datasets,
              [id]: { ...ds, name, updatedAt: nowIso() },
            },
          };
        }),

      deleteDataset: (id) =>
        set((s) => {
          if (!s.datasets[id]) return s;
          const { [id]: _removed, ...rest } = s.datasets;
          const remainingIds = Object.keys(rest);
          const nextActive =
            s.activeDatasetId === id ? (remainingIds[0] ?? null) : s.activeDatasetId;
          return { datasets: rest, activeDatasetId: nextActive };
        }),

      setActiveDataset: (id) => set({ activeDatasetId: id }),

      duplicateDataset: (id, newName) => {
        const src = get().datasets[id];
        if (!src) return null;
        const copy = newDataset(newName, {
          defaultDetectionMode: src.defaultDetectionMode,
          exportOutputType: src.exportOutputType,
          files: src.files.map((f) => ({
            ...f,
            id: makeId(f.sourceLabel),
          })),
          currentFileId: null,
        });
        set((s) => ({ datasets: { ...s.datasets, [copy.id]: copy } }));
        return copy.id;
      },

      setDatasetExportType: (id, t) =>
        set((s) => {
          const ds = s.datasets[id];
          if (!ds) return s;
          return {
            datasets: {
              ...s.datasets,
              [id]: { ...ds, exportOutputType: t, updatedAt: nowIso() },
            },
          };
        }),

      setDatasetDefaultMode: (id, mode) =>
        set((s) => {
          const ds = s.datasets[id];
          if (!ds) return s;
          return {
            datasets: {
              ...s.datasets,
              [id]: { ...ds, defaultDetectionMode: mode, updatedAt: nowIso() },
            },
          };
        }),

      addFiles: (datasetId, files) =>
        set((s) => {
          const ds = s.datasets[datasetId];
          if (!ds) return s;
          const merged = [...ds.files, ...files];
          return {
            datasets: {
              ...s.datasets,
              [datasetId]: {
                ...ds,
                files: merged,
                currentFileId: ds.currentFileId ?? files[0]?.id ?? null,
                updatedAt: nowIso(),
              },
            },
          };
        }),

      removeFile: (datasetId, fileId) =>
        set((s) => {
          const ds = s.datasets[datasetId];
          if (!ds) return s;
          const files = ds.files.filter((f) => f.id !== fileId);
          return {
            datasets: {
              ...s.datasets,
              [datasetId]: {
                ...ds,
                files,
                currentFileId: ds.currentFileId === fileId ? null : ds.currentFileId,
                updatedAt: nowIso(),
              },
            },
          };
        }),

      clearFiles: (datasetId) =>
        set((s) => {
          const ds = s.datasets[datasetId];
          if (!ds) return s;
          return {
            datasets: {
              ...s.datasets,
              [datasetId]: { ...ds, files: [], currentFileId: null, updatedAt: nowIso() },
            },
          };
        }),

      updateFile: (datasetId, fileId, patch) =>
        set((s) => {
          const ds = s.datasets[datasetId];
          if (!ds) return s;
          const files = ds.files.map((f) => (f.id === fileId ? { ...f, ...patch } : f));
          return {
            datasets: {
              ...s.datasets,
              [datasetId]: { ...ds, files, updatedAt: nowIso() },
            },
          };
        }),

      setFileResolved: (datasetId, fileId, resolved) =>
        set((s) => {
          const ds = s.datasets[datasetId];
          if (!ds) return s;
          const files = ds.files.map((f) => (f.id === fileId ? { ...f, resolved } : f));
          return {
            datasets: {
              ...s.datasets,
              [datasetId]: { ...ds, files, updatedAt: nowIso() },
            },
          };
        }),

      setCurrentFile: (datasetId, fileId) =>
        set((s) => {
          const ds = s.datasets[datasetId];
          if (!ds) return s;
          return {
            datasets: {
              ...s.datasets,
              [datasetId]: { ...ds, currentFileId: fileId },
            },
          };
        }),

      replaceFileAnnotations: (datasetId, fileId, spans, opts) =>
        set((s) => {
          const ds = s.datasets[datasetId];
          if (!ds) return s;
          const files = ds.files.map((f) => {
            if (f.id !== fileId) return f;
            return {
              ...f,
              annotations: spans,
              detectedAt: spans,
              detectionStatus: 'ready' as DetectionStatus,
              lastDetectionTarget: opts.target,
              processingTimeMs: opts.processingTimeMs,
              surrogateText: opts.surrogateText ?? null,
              annotationsOnSurrogate: opts.annotationsOnSurrogate ?? null,
              resolved: opts.clearResolved ? false : f.resolved,
              error: undefined,
            };
          });
          return {
            datasets: {
              ...s.datasets,
              [datasetId]: { ...ds, files, updatedAt: nowIso() },
            },
          };
        }),
    }),
    persistOptions,
  ),
);

export function useActiveDataset(): Dataset | null {
  return useProductionStore((s) =>
    s.activeDatasetId ? (s.datasets[s.activeDatasetId] ?? null) : null,
  );
}

/**
 * True once zustand-persist has finished async rehydration from IndexedDB.
 * Gate any bootstrap-on-empty-state logic on this, or you will write phantom
 * defaults on top of the user's real persisted data.
 */
export function useHasHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() =>
    useProductionStore.persist?.hasHydrated() ?? false,
  );
  useEffect(() => {
    const unsubFinish = useProductionStore.persist?.onFinishHydration(() =>
      setHydrated(true),
    );
    if (useProductionStore.persist?.hasHydrated()) setHydrated(true);
    return () => unsubFinish?.();
  }, []);
  return hydrated;
}
