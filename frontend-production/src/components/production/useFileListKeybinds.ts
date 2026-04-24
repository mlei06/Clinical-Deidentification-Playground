import { useEffect } from 'react';
import type { DatasetFile, Dataset } from './store';
import { useProductionStore } from './store';

interface KeybindArgs {
  dataset: Dataset | null;
  visible: DatasetFile[];
  /** DOM element that must contain the active element for shortcuts to fire. */
  rootRef: React.RefObject<HTMLElement | null>;
  /** Fire only while the workbench is in focus — disabled during other flows. */
  enabled?: boolean;
  /** Called when the cheat-sheet modal should open. */
  onOpenCheatSheet?: () => void;
}

/**
 * Keyboard navigation for the dataset workbench:
 *
 * - `↑` / `↓` move the current file within the visible list.
 * - `j` / `k` jump to the next / previous unresolved file.
 * - `n` jumps to the next file whose detection failed.
 * - `r` toggles resolved on the current file.
 * - `?` opens the cheat-sheet modal (when `onOpenCheatSheet` is provided).
 *
 * Shortcuts only fire while the workbench root contains the active element
 * **and** the active element is not an editable field (input / textarea /
 * contenteditable) — so single-letter keys don't hijack typing in notes or
 * filters.
 */
export function useFileListKeybinds({
  dataset,
  visible,
  rootRef,
  enabled = true,
  onOpenCheatSheet,
}: KeybindArgs): void {
  const setCurrentFile = useProductionStore((s) => s.setCurrentFile);
  const setFileResolved = useProductionStore((s) => s.setFileResolved);

  useEffect(() => {
    if (!enabled || !dataset) return;
    const root = rootRef.current;
    if (!root) return;

    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (active) {
        if (!root.contains(active)) return;
        const tag = active.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          active.isContentEditable
        ) {
          return;
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (visible.length === 0) return;

      const currentIdx = visible.findIndex((f) => f.id === dataset.currentFileId);
      const pickAt = (idx: number) => {
        if (idx < 0 || idx >= visible.length) return;
        setCurrentFile(dataset.id, visible[idx].id);
      };
      const findNext = (
        from: number,
        direction: 1 | -1,
        pred: (f: DatasetFile) => boolean,
      ): number => {
        let i = from;
        for (let step = 0; step < visible.length; step++) {
          i = (i + direction + visible.length) % visible.length;
          if (pred(visible[i])) return i;
        }
        return -1;
      };

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          pickAt(currentIdx < 0 ? 0 : Math.min(currentIdx + 1, visible.length - 1));
          return;
        case 'ArrowUp':
          e.preventDefault();
          pickAt(currentIdx <= 0 ? 0 : currentIdx - 1);
          return;
        case 'j':
        case 'J': {
          e.preventDefault();
          const hit = findNext(currentIdx, 1, (f) => !f.resolved);
          if (hit >= 0) pickAt(hit);
          return;
        }
        case 'k':
        case 'K': {
          e.preventDefault();
          const hit = findNext(currentIdx, -1, (f) => !f.resolved);
          if (hit >= 0) pickAt(hit);
          return;
        }
        case 'n':
        case 'N': {
          e.preventDefault();
          const hit = findNext(
            currentIdx < 0 ? -1 : currentIdx,
            1,
            (f) => f.detectionStatus === 'error',
          );
          if (hit >= 0) pickAt(hit);
          return;
        }
        case 'r':
        case 'R': {
          if (dataset.currentFileId) {
            const current = visible.find((f) => f.id === dataset.currentFileId);
            if (current) {
              e.preventDefault();
              setFileResolved(dataset.id, current.id, !current.resolved);
            }
          }
          return;
        }
        case '?':
          if (onOpenCheatSheet) {
            e.preventDefault();
            onOpenCheatSheet();
          }
          return;
        default:
          return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dataset, enabled, onOpenCheatSheet, rootRef, setCurrentFile, setFileResolved, visible]);
}
