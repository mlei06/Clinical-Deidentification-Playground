# Implementation plan: per-document saved output + workflow-aligned layout (frontend-production)

Two coordinated reworks of `frontend-production/`:

1. **Per-document saved output** — replace the dataset-level `exportOutputType` and on-the-fly `/process/redact` previews with an explicit **Save output** action that materializes per-document output (text + spans + mode + hash). Export concatenates saved outputs; mode is purely per-document.
2. **Workflow-aligned layout** — split the flat top-nav (Library / Workspace / Settings / Audit) into a two-tier shell: global routes on top, dataset-scoped sub-tabs (Files / Detect / Review / Export) below. Export becomes a browseable per-document preview backed by saved outputs.

The two workstreams are independently revertable. **Workstream A ships first** — it's the user-visible correctness fix and unblocks B3.5 (browseable export preview without paging-induced API churn).

---

## Background: what's wrong today

- **Output preview lies.** The right-hand "Output" pane in `DocumentReviewer` is driven by a local `previewMode` state that the reviewer toggles between `redacted` and `surrogate`. Meanwhile `DatasetExportBar.buildLine` writes the JSONL based on `dataset.exportOutputType`, which has three values (`annotated`, `redacted`, `surrogate_annotated`). The preview can't represent `annotated` at all, can't reflect what the export will actually contain, and the surrogate output it shows isn't the surrogate output that gets exported (Faker is non-deterministic — re-running produces different bytes).
- **Settings is dataset-scoped but lives at the global nav level.** `Library` and `Audit` are global; `Workspace` and `Settings` require an active dataset (`RequireActiveDataset`). They sit as peer tabs, hiding the workflow ordering and stranding export config on a separate page from review.
- **Browsing a dataset's "shape" is impossible.** No surface lets a reviewer page through documents and see what the dataset will look like exported, short of running the full export.

---

## Guiding decisions

- **Output mode is per-document, not per-dataset.** Drop `Dataset.exportOutputType` entirely; no replacement (no `defaultSaveMode` either). Each document carries its own `savedOutput.mode`.
- **Save is always a snapshot, including for `annotated`.** Every mode captures a snapshot of `file.annotations` at save time (`annotationsAtSave`) so export emits exactly what was saved, not what's currently in the editor. `redacted` and `surrogate_annotated` additionally snapshot the materialized output text via `/process/redact`. `annotated` skips the API call (no async, no randomness) but still snapshots its spans — without that snapshot, edits after save would silently change the next export's bytes, violating the source-of-truth contract.
- **Span edits do not auto-regenerate output.** They invalidate the saved output (mark **stale** via hash mismatch on `annotationsAtSave`). The reviewer re-saves explicitly.
- **Save button is a split button.** Primary action saves in the doc's last-saved mode (or the split-button's currently shown mode if never saved); dropdown picks a different mode. No dataset-level default; no session-sticky default.
- **Export concatenates saved outputs.** `DatasetExportBar` reads `savedOutput` per file and emits one JSONL line per doc. Pre-flight panel surfaces unsaved + stale docs and offers a bulk re-save.
- **No new backend.** All changes are in `frontend-production/`. The existing `POST /process/redact` endpoint and `production_v1` line format already cover what's needed.

---

## Constraints

- **One source of truth for output.** A shared helper (`buildSavedOutput`) is the only code path that computes saved output bytes. Both the per-doc Save action and the bulk-save action call it. `DatasetExportBar` reads `savedOutput` directly — it never recomputes.
- **No silent data loss on migration.** Existing files with `surrogateText` + `annotationsOnSurrogate` migrate into `savedOutput` with mode `surrogate_annotated` and a sentinel hash that marks them stale, so reviewers see "stale, please re-save" rather than shipping pre-migration bytes.
- **Bookmarks survive.** `/workspace` and `/settings` redirect to the new dataset-scoped routes for one release.

---

## IMPL-M1 — Per-document saved output (data + helpers, additive)

**Why first:** the data shape and helpers are prerequisites for every other change. **PR1 is purely additive** — no fields removed, no actions deleted, no UI touched. Old surfaces keep working unchanged. Removal of legacy fields happens in IMPL-M5 once all consumers have migrated.

### Store

- `frontend-production/src/components/production/store.ts`
  - Add `SavedOutput` type and the `savedOutput?: SavedOutput | null` field on `DatasetFile`:
    ```ts
    export type SavedOutputMode = 'annotated' | 'redacted' | 'surrogate_annotated';

    export interface SavedOutput {
      mode: SavedOutputMode;
      text: string | null;                  // null when mode === 'annotated'; export uses file.originalText
      spans: EntitySpanResponse[];          // snapshot at save time:
                                            //   annotated → snapshot of annotations
                                            //   redacted → []
                                            //   surrogate_annotated → aligned spans on surrogate text
      annotationsAtSave: EntitySpanResponse[]; // always a snapshot of file.annotations at save time —
                                            // the input to the saved output. For annotated this equals
                                            // `spans`; for redacted/surrogate it's the source spans
                                            // that drove redaction.
      sourceTextHash: string;               // hash of file.originalText at save time (defensive)
      savedAt: string;                      // ISO
    }
    ```
  - **Do not remove** `surrogateText`, `annotationsOnSurrogate`, or `exportOutputType` in this PR. They remain alongside the new field; legacy code paths keep using them.
  - Add `saveFileOutput(datasetId, fileId, output: SavedOutput)` and `clearFileOutput(datasetId, fileId)` actions.
  - Bump persist version. Migration: for each file with `surrogateText` + `annotationsOnSurrogate`, populate `savedOutput = { mode: 'surrogate_annotated', text: surrogateText, spans: annotationsOnSurrogate, annotationsAtSave: [], sourceTextHash: '__legacy__', savedAt: createdAt }`. Keep the legacy fields populated too (they'll be removed in M5). The `__legacy__` sentinel ensures `isSavedOutputStale(file)` returns `true` for migrated docs.

### Helpers

- New file: `frontend-production/src/components/production/savedOutput.ts`
  - `hashAnnotations(spans: EntitySpanResponse[]): string` — stable hash of sorted `start|end|label` joins.
  - `hashSourceText(text: string): string` — stable hash of `file.originalText` (length + content hash; cheap).
  - `isSavedOutputStale(file: DatasetFile): boolean` — `true` iff `file.savedOutput` exists and **either**
    - `hashAnnotations(file.annotations) !== hashAnnotations(file.savedOutput.annotationsAtSave)`, **or**
    - `hashSourceText(file.originalText) !== file.savedOutput.sourceTextHash`.

    The source-text check is defensive — `originalText` is immutable in current actions but a future code path (e.g. text re-normalization) could mutate it; this catches that case.
  - `buildSavedOutput(args): Promise<SavedOutput>` — given `(file, mode, reviewer)`, returns a `SavedOutput`. For all three modes, captures `annotationsAtSave: [...file.annotations]` and `sourceTextHash: hashSourceText(file.originalText)`. For `annotated`, no API call (`text: null`, `spans: [...file.annotations]`). For `redacted` and `surrogate_annotated`, calls `redactDocument(...)` (with `include_surrogate_spans: true` for surrogate) and packages the result. **This is the only path to a `SavedOutput`** — both per-doc Save and bulk Save call it.
  - `previewBytes(file): { text: string, spans: EntitySpanResponse[], mode: SavedOutputMode } | null` — pure, no API. Reads strictly from `file.savedOutput`:
    - `annotated` → `{ text: file.originalText, spans: savedOutput.spans, mode: 'annotated' }` (uses snapshot spans, not live `file.annotations`).
    - `redacted` → `{ text: savedOutput.text!, spans: [], mode: 'redacted' }`.
    - `surrogate_annotated` → `{ text: savedOutput.text!, spans: savedOutput.spans, mode: 'surrogate_annotated' }`.
    - No saved output → `null` (caller decides what to render).

### Tests

- Unit: `hashAnnotations` (order-independent), `hashSourceText` (length + content), `isSavedOutputStale` (annotation drift, source-text drift, legacy sentinel), `buildSavedOutput` (each mode, error path), `previewBytes` (each mode, null case).
- Migration: dataset with legacy `surrogateText` lands as stale `savedOutput`; legacy fields preserved.

**Definition of done:** the store carries `savedOutput` per file, helpers ship, migration runs on persisted state without breaking existing UI. PR1 typechecks, builds, and runs without changing observable behavior — `DocumentReviewer`, `DatasetExportBar`, and `SettingsView` all still read the legacy fields they did before. M2 onward begins migrating consumers.

---

## IMPL-M2 — Review pane reads saved output; Save split-button replaces "Update output"

**Why next:** wires the Save action into the existing review surface without touching routing. After this PR, the Output pane is faithful to whatever's saved (or live-derived for annotated).

### `DocumentReviewer.tsx`

- Remove local `previewMode` state and the `OutputModeToggle` from the right-pane header.
- Right-pane content driven by `previewBytes(file)`:
  - `null` (no saved output, no annotations) → "No output yet — save the current annotations."
  - `{ mode: 'annotated' }` → `<SpanHighlighter text={originalText} spans={annotations} />` live.
  - `{ mode: 'redacted' }` → `<RedactedView text={savedOutput.text} />`.
  - `{ mode: 'surrogate_annotated' }` → `<SpanHighlighter text={savedOutput.text} spans={savedOutput.spans} />`.
- Right-pane header status line: one of
  - `Live preview · annotated`
  - `Saved · redacted · 14:32`
  - `Saved · surrogate · 14:32 · stale` (when `isSavedOutputStale`)
  - `No saved output`
- Drop `runPreview`, `previewMode`, `previewText`, `previewModeFromOutputMode`. The right pane no longer makes API calls on mode toggle (because there is no toggle).

### Save split-button (in `SpanEditor` aside)

- Replace the existing `onUpdateOutput` button with a split button:
  - Primary label = `Save {currentMode}`. `currentMode` is `file.savedOutput?.mode ?? 'annotated'`.
  - Dropdown items: `annotated`, `redacted`, `surrogate_annotated`. Picking one switches the primary action's mode for the next click only (does not re-save automatically).
- On click: call `buildSavedOutput(...)`, dispatch `saveFileOutput(...)`. Show a spinner inside the button while pending; show an inline error on failure.
- When saved output is stale, the button gets an amber ring and the label reads `Save {currentMode} · out of date`. (Don't compute "{N} changes" from `file.annotations.length - savedOutput.spans.length` — for `redacted`, saved spans are intentionally `[]`, which would always read as "all annotations changed.") A precise count, if needed later, is the symmetric diff between `hashAnnotations(file.annotations)` keys and `hashAnnotations(savedOutput.annotationsAtSave)` keys; defer until reviewers ask for it.
- Additionally, M2 stops populating the legacy `surrogateText` / `annotationsOnSurrogate` on save — `DocumentReviewer.runPreview` is replaced by `buildSavedOutput`. Legacy fields stay readable for any other consumers (still removed in M5) but are no longer written.

### Tests

- Component: stale-state styling, mode dropdown switches primary action label, error path renders inline.

**Definition of done:** Review pane never calls `/process/redact` on its own (no preview-mode toggle exists). The only API call from this view is the explicit Save click. Existing reset/conflict/ghost flows unchanged.

---

## IMPL-M3 — Routing scaffold + two-tier shell

**Why next:** lays the routing groundwork before splitting `WorkspaceView`. Old surfaces remain reachable via redirects so this PR doesn't visibly change behavior — it's plumbing.

### Routes

- `frontend-production/src/App.tsx`
  - Replace flat routes with:
    ```
    /library                          (global)
    /audit                            (global)
    /datasets/:id/files
    /datasets/:id/detect
    /datasets/:id/review
    /datasets/:id/review/:fileId
    /datasets/:id/export
    ```
  - `RequireActiveDataset` becomes `RequireDatasetParam`: reads `:id`, sets it active in the store if not already, redirects to `/library` if missing.
  - Backward-compat redirects: `/workspace` → `/datasets/:active/review`; `/settings` → `/datasets/:active/export` (Settings becomes Export's home; reviewer-name moves to global cog — see M4).

### Shell

- `frontend-production/src/components/layout/ProductionShell.tsx`
  - Top bar (global): `Library`, `Audit`, right-aligned settings cog popover (reviewer name + global preferences only).
  - Below it, when on `/datasets/:id/*`, render `DatasetSubShell`:
    - Left: `DatasetSwitcher` + dataset name + progress chip (`{resolved}/{total} resolved`).
    - Right: workflow sub-tabs `Files / Detect / Review / Export` with per-tab status badges:
      - Files: file count.
      - Detect: number of files in `pending` or `error` status.
      - Review: number of `ready`-but-`!resolved` files.
      - Export: number of files with no saved output OR stale saved output.
  - Breadcrumb extends to `Library > {name} > {step} [> {fileSourceLabel}]` on Review.

### Tests

- Unit: `RequireDatasetParam` redirects when `:id` missing; sub-tab status badges compute against fixture datasets.

**Definition of done:** all old routes still work via redirect; new routes render `WorkspaceView` (Files/Detect/Review temporarily share the existing component) and `SettingsView` (Export temporarily — until M5 replaces it). No UI is meaningfully different yet.

---

## IMPL-M4 — Split `WorkspaceView` into Files / Detect / Review steps

**Why:** splits the existing `WorkspaceView` into three step components, each owning its slice of the current screen. Mechanical refactor.

### New files under `frontend-production/src/components/production/steps/`

- `FilesStep.tsx`
  - Owns `DatasetFileList`, `PasteModal`, drag-drop upload. Pulled from current Workspace's left column.
  - Adds dataset metadata header: name, file count, default detection mode picker (moved from `SettingsView`).
  - Reviewer-name field (moved from `SettingsView`) lives in the global cog popover, not here.
- `DetectStep.tsx`
  - Owns the run header from current `WorkspaceView` (mode picker, run/cancel, batch progress) and the per-file status from `DatasetFileList` (read-only, with a "Run on selection" CTA).
  - Surfaces a per-file status table (sortable by detection status) so reviewers can spot errors quickly.
- `ReviewStep.tsx`
  - Owns `DocumentReviewer` and a slim file rail (read-only file list with status icons; reuses `useFileListKeybinds`).
  - Deep-link support: `/datasets/:id/review/:fileId` selects that file via `setCurrentFile`.

### `useWorkspaceController.ts`

- Most of it (run target, mode resolution, run/cancel, progress) moves into `DetectStep`. Shared selection state (`selectedIds`, `currentFile`) stays in `useProductionStore`.

### Cross-cutting

- Keep all current keyboard shortcuts working in their respective steps.
- Disable Review tab when `dataset.files.length === 0`. Don't disable Export — pre-export browsing is the whole point of M5.

**Definition of done:** the three steps render the same surfaces they did under `WorkspaceView`, but on dedicated routes. No behavior changes beyond navigation.

---

## IMPL-M5 — Export step: browseable per-document preview + bulk save

**Why:** the user-visible payoff. With saved output as the source of truth (M1) and routing in place (M3), the Export step becomes a fast, deterministic browse view backed entirely by store reads — no API calls on paging.

### `ExportStep.tsx` layout

```
┌──────────────┬──────────────────────────────────────────────────┐
│ Document rail│  Doc 7 / 24   ◀  ▶   ✓ resolved · 3 spans · S    │
│              │  ┌──────────────────────────────────────────┐    │
│ ▸ note_001 A │  │                                          │    │
│ ▸ note_002 R │  │   Saved output (surrogate_annotated)     │    │
│ ▸ note_003 — │  │                                          │    │
│ ▸ note_004 S │  │                                          │    │
│  …           │  └──────────────────────────────────────────┘    │
│              │  [Save annotated ▾] for this doc · [Edit in     │
│              │   Review]                                        │
│              │  ─────────────────────────────────────────────── │
│              │  Bulk: [Save redacted ▾] for [N unsaved/stale]   │
│              │  ─────────────────────────────────────────────── │
│              │  Scope: [All / Resolved only]   [Download .jsonl]│
└──────────────┴──────────────────────────────────────────────────┘
```

### Document rail

- Read-only variant of `DatasetFileList`: source label, status icons, span count, **save-mode chip** (`A` / `R` / `S` / `—` for unsaved), staleness flag.
- Filter chips: `All / Resolved only / Flagged / Unresolved` plus `By save mode: [annotated | redacted | surrogate | unsaved | stale]`.
- When `Scope = Resolved only` is active in the export bar below, dim non-resolved rows.
- Click selects; no checkboxes, no delete. Keyboard `J/K` for next/previous (parity with Review).

### Preview pane

- Renders `previewBytes(currentFile)` — pure store read, **no API call on paging**.
- Header: `Doc N / M`, prev/next, status chip, span count, save metadata (`Saved 14:32 by alice` / `No saved output` / `Stale`).
- Inline per-doc Save split button (same component as in M2's Review pane), so reviewers can re-save without leaving the Export step.
- "Edit in Review" link → `/datasets/:id/review/:fileId`.
- URL-driven selection via `?file=:fileId` for shareable preview links.

### Bulk save

- Action bar above the export bar: `[Save {mode} ▾] for [N docs without saved output OR stale]` where `mode` defaults to whatever the dropdown shows.
- On click: iterates files matching the filter and calls `buildSavedOutput` per file; shows progress (`Saved 12 / 47…`) with a Cancel button. Errors collected and shown in a summary toast.
- The set of "candidates" is derived live: files with `!savedOutput || isSavedOutputStale(f)`. Resolved-only filter on the export bar narrows further.

### Aggregate header

Above the rail, one-line summary:

```
24 docs · 18 resolved · 3 flagged · 1 detection error · 412 spans across 11 labels · 2 unsaved · 1 stale
```

Selectors over `dataset.files`.

### `DatasetExportBar` simplification

- Remove `redactDocument` calls from `buildLine`. The exported bytes are exactly what `previewBytes` returns — no live `file.annotations` reads, no recomputation:
  ```ts
  function buildLine(file, dataset, reviewer, exportedAt): JsonlLine {
    const bytes = previewBytes(file);
    if (!bytes) throw new Error(`${file.sourceLabel}: no saved output`);
    return {
      schema_version: 1,
      id: file.id,
      source_label: file.sourceLabel,
      output_type: bytes.mode,
      text: bytes.text,
      spans: bytes.spans,         // snapshot spans for annotated; [] for redacted; aligned for surrogate
      resolved: file.resolved,
      metadata: { ... },
    };
  }
  ```
  Note: for `annotated`, `spans` comes from `savedOutput.spans` (the snapshot at save time), **not** `file.annotations`. If a reviewer edits spans after saving annotated, the doc reads stale and either gets re-saved or skipped at export — it never silently exports drifted bytes.
- Pre-flight panel before download:
  - List of files with no saved output OR stale saved output.
  - "Save them now" button → opens bulk-save dialog pre-scoped to those.
  - "Skip stale and unsaved" toggle (default on) — skipped files are listed in the post-export summary.
- Remove the export-type selector entirely.
- Keep "Register on server" and "Wrap in .zip with manifest" as-is.

### Library deep-link

- `LibraryView.tsx`: add a `Preview` button next to `Open workspace` on each dataset card → `/datasets/:id/export`.

### Migration cleanup

- Delete `SettingsView.tsx`. The `/settings` redirect (M3) now points at `/datasets/:active/export`.
- Reviewer-name field lives in the global cog popover (M3); confirm there's no remaining reference in dataset-scoped views.
- **Now safe to remove legacy fields** (deferred from M1): drop `surrogateText`, `annotationsOnSurrogate` from `DatasetFile`; drop `exportOutputType` from `Dataset`; drop `setDatasetExportType` from store actions; drop `DEFAULT_EXPORT_TYPE`. Bump persist version again with a no-op migration that strips the dead fields. `useBatchDetect.ts` and any other consumers are migrated to write `savedOutput` (or simply not write surrogate bytes — detection produces spans, save materializes output).

### Tests

- Unit: `previewBytes` returns correct shape per mode; bulk-save iterates the right set; `buildLine` skips/throws cleanly on missing saved output.
- Integration: paging through 100 docs in Export makes zero `redactDocument` calls (assert via mock).
- Manual: full flow from Library → upload `.jsonl` → Detect → Review (edit + save) → Export (browse, bulk-save remainder, download). Verify exported `text` field byte-matches the Export-step preview for each line.

**Definition of done:** Export step renders the dataset as it will ship; paging is instant; download produces a JSONL whose `text`/`spans` fields are byte-equal to what the reviewer saw.

---

## Sequencing & PR boundaries

| PR | Milestones | Scope |
|----|------------|-------|
| 1  | IMPL-M1 | **Additive only.** Add `savedOutput` field + helpers + migration; populate from legacy fields. No fields removed; no UI changed; no consumer migrated yet. Typechecks and runs unchanged. |
| 2  | IMPL-M2 | Review pane reads `savedOutput` via `previewBytes`; Save split-button replaces "Update output". Stops writing legacy surrogate fields (legacy fields still readable for other consumers). Old layout intact. |
| 3  | IMPL-M3 | Routing scaffold + two-tier shell + redirects. No content changes. |
| 4  | IMPL-M4 | Split `WorkspaceView` into Files / Detect / Review steps. Export still shows old `DatasetExportBar`-only view. |
| 5  | IMPL-M5 | Export step browseable preview, bulk save, simplified export bar (reads `previewBytes` only). Delete `SettingsView`. **Now remove legacy fields** (`surrogateText`, `annotationsOnSurrogate`, `exportOutputType`, `setDatasetExportType`) — all consumers migrated. |

Each PR is independently revertable. PR 1 is the smallest and PR 5 is the largest (~400 LOC, mostly composition).

---

## Risks

- **Stale-output discipline.** The whole model rests on reviewers noticing the "stale" indicator and re-saving. Mitigations: stale chip on every surface (Review header, Export rail row, Export preview); pre-flight panel before download; bulk-save action that defaults to "stale or unsaved."
- **Migration of legacy surrogate output.** Pre-migration files with `surrogateText` survive as `savedOutput` but with a sentinel hash so they read as stale. Reviewers will see a wave of stale chips on first load; the bulk-save action handles it in one click. Document this in the changelog.
- **Save errors mid-bulk.** Bulk-save must continue past per-file errors and surface them in a summary, not abort. Otherwise a single transient `redactDocument` failure halts the whole batch.
- **Annotated mode storage.** `savedOutput.text` is `null` for annotated saves; `previewBytes` materializes `text` from `file.originalText` and `spans` from `savedOutput.spans` (the snapshot, not live `file.annotations`). Covered by `previewBytes` and `buildLine` test fixtures.
- **Snapshot-vs-live parity for annotated.** Because `previewBytes` for annotated reads `savedOutput.spans` (snapshot) but the Review-pane editor displays `file.annotations` (live), reviewers will see the editor diverge from the saved preview as soon as they edit. The stale chip + Save split-button surface this; the editor and preview are not meant to be the same view. Documenting it here so future reviewers don't mistake it for a bug.
- **Cross-document surrogate consistency.** Today's surrogate consistency is per-call (within a doc only). Saving doc-by-doc doesn't make this worse, but it makes it visible. Out of scope here; flag in the Export-step UI as a known limitation if reviewers ask.

---

## Out of scope

- Backend changes (no new endpoints, no `production_v1` schema bump).
- Cross-document surrogate consistency.
- Editable preview in the Export step (it stays read-only; reviewers click "Edit in Review" to mutate).
- Any change to detection, evaluation, or audit surfaces.
