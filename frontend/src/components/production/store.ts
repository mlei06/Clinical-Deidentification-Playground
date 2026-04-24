import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { EntitySpanResponse } from '../../api/types';

export type DocStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'reviewed'
  | 'flagged'
  | 'error';

export interface QueueDoc {
  id: string;
  sourceName: string;
  text: string;
  status: DocStatus;
  detectedSpans: EntitySpanResponse[];
  editedSpans: EntitySpanResponse[];
  redactedText: string;
  note?: string;
  processingTimeMs?: number;
  error?: string;
  reviewedAt?: string;
}

interface State {
  reviewer: string;
  mode: string;
  docs: QueueDoc[];
  currentId: string | null;
  setReviewer: (name: string) => void;
  setMode: (mode: string) => void;
  addDocs: (docs: QueueDoc[]) => void;
  removeDoc: (id: string) => void;
  clear: () => void;
  setCurrent: (id: string | null) => void;
  updateDoc: (id: string, patch: Partial<QueueDoc>) => void;
  advance: () => void;
}

export const useReviewQueue = create<State>()(
  persist(
    (set, get) => ({
      reviewer: '',
      mode: '',
      docs: [],
      currentId: null,

      setReviewer: (name) => set({ reviewer: name }),
      setMode: (mode) => set({ mode, docs: [], currentId: null }),

      addDocs: (docs) =>
        set((s) => ({
          docs: [...s.docs, ...docs],
          currentId: s.currentId ?? docs[0]?.id ?? null,
        })),

      removeDoc: (id) =>
        set((s) => ({
          docs: s.docs.filter((d) => d.id !== id),
          currentId: s.currentId === id ? null : s.currentId,
        })),

      clear: () => set({ docs: [], currentId: null }),

      setCurrent: (id) => set({ currentId: id }),

      updateDoc: (id, patch) =>
        set((s) => ({
          docs: s.docs.map((d) => (d.id === id ? { ...d, ...patch } : d)),
        })),

      advance: () => {
        const { docs, currentId } = get();
        const idx = docs.findIndex((d) => d.id === currentId);
        const next = docs
          .slice(idx + 1)
          .find((d) => d.status === 'ready' || d.status === 'pending');
        set({ currentId: next?.id ?? null });
      },
    }),
    {
      name: 'production-queue',
      partialize: (s) => ({
        reviewer: s.reviewer,
        mode: s.mode,
        docs: s.docs,
        currentId: s.currentId,
      }),
    },
  ),
);
