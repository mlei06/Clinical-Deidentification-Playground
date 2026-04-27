# Design: split Annotate from Export, drop per-file saved output

> Status: hardened proposal (2026-04-27).
>
> Drives a redesign of the Production UI's "Review" + save/output flow into
> two single-purpose surfaces, deletes the per-file `SavedOutput` concept,
> and replaces it with on-demand batch generation in an Export tab plus an
> optional inline preview column in the Annotate tab.

## Goals

- One mental model per surface: Annotate = span CRUD; Export = produce + ship artifacts.
- Eliminate per-file saved-output state and the staleness machinery around it.
- Stop conflating *preview* with *commit*: previewing redacted/surrogate text must never write to the store.
- Make output shape (annotated / redacted / surrogate) a function of the current annotations, computed on demand.
- Keep an opt-in preview affordance during annotation so reviewers don't have to tab-dance for fix-and-verify cycles.

### Non-goals (v1)

- New export formats. Existing JSONL / CoNLL / spaCy / HuggingFace / BRAT outputs stay unchanged.
- Backend API changes. The redesign is entirely frontend-production-side, riding existing `/process/redact`, `/datasets/import/jsonl`, `/datasets/ingest-from-pipeline`, etc.
- Edit-the-surrogate-value flows. Surrogate values are derived; non-editable.

---

## 1. Conceptual model

Today's "Review" surface fuses three jobs in one screen — span editing, output preview, and save-as-artifact — and persists per-file `SavedOutput` snapshots that go stale on every span edit. The redesign splits those jobs across two tabs and drops the persisted snapshot entirely:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Detect → Annotate → Export                                             │
│                                                                        │
│ Annotate (per file)                                                    │
│   ┌──────────────┬──────────────┬──────────────┐                       │
│   │   Source     │    Spans     │  Preview*    │   * collapsible       │
│   │ (annotated)  │   sidebar    │  (redacted/  │                       │
│   │              │              │   surrogate) │                       │
│   └──────────────┴──────────────┴──────────────┘                       │
│                                                                        │
│ Export (per dataset)                                                   │
│   scope + output type + seed → [Generate Output]                       │
│   then: preview pager + [Download] + [Register as dataset]             │
└────────────────────────────────────────────────────────────────────────┘
```

The two surfaces share **one** abstraction — the file's current `annotations` array — and one client-side cache keyed by `(textHash, annotationsHash, mode, seed)` that both the Annotate preview column and the Export batch consult.

---

## 2. Annotate tab

### 2.1 Layout

`[ Source | Spans | Preview ]`. Source and Spans are the two existing columns from `DocumentReviewer`'s left pane and editor sidebar. Preview is **new** and **hidden by default**.

| State | Source | Spans | Preview |
|-------|--------|-------|---------|
| Default | flex-1 | fixed-width sidebar (today's `aside`) | hidden |
| Preview shown | flex shrinks to ~50–60% | unchanged | flex ~25–35%, resizable |

When the preview column is hidden, a thin vertical "Preview" pill renders at the right edge of the source pane — clicking re-shows the column. No control for it lives in the document header or the Spans sidebar.

### 2.2 What's gone from Annotate

- The right output pane (today's `ReviewerDualPane` right column) and its three render modes (annotated / redacted / surrogate). Replaced by the optional Preview column.
- The Save button group (`SaveOutputButton`) embedded in the Spans sidebar. The Spans sidebar becomes pure span CRUD: list, group, edit, delete, conflict resolution, reset.
- `Flag` and `Mark resolved` controls in the document header.
- The "Saved · annotated · 14:30 · stale" status line in the right-pane header.

### 2.3 Where Flag and Mark resolved go

Both become per-row chips in the **file list** (`DatasetFileList`), settable with one click from any tab. Justification: they describe file lifecycle, not document content; they should be visible from every surface that lists files (Detect, Annotate, Export). Today's keyboard shortcuts (`F` / `R` from `useFileListKeybinds`) keep working unchanged.

### 2.4 Preview column

Header controls (top of the column):

```
[Redacted | Surrogate]  seed: [______]  (×) close
```

- **Mode toggle:** redacted vs surrogate. No "annotated" — that's already the source pane.
- **Seed input** (visible only when surrogate is active): integer or short string, persisted on the file (`DatasetFile.surrogateSeed`). Defaults to a stable hash of the file id, so the same file always starts deterministic.
- **Close (×):** hides the column; pill returns at the source's right edge.

Body: rendered redacted text (plain) or surrogate text (rendered with `SpanHighlighter` keyed off `res.surrogate_spans`).

Behavior:

1. The first time the column is shown for a file (or after annotations change, mode flips, seed changes), kick off a `/process/redact` call.
2. Debounce span edits ~300 ms before refetching.
3. While loading, dim the column body and show a small spinner; previous content stays visible.
4. Cache results in the shared client cache keyed by `(textHash, annotationsHash, mode, seed)`. Cache hit → instant; cache miss → fetch.
5. On error, render the error inline with a "Retry" button; do not surface as a global error.

### 2.5 Why the seed matters here

Without a seed, every span edit reshuffles every surrogate value in the visible document — which makes "did this span change anything I care about?" almost impossible to answer at a glance. With a per-file seed, only the surrogate value of the touched span(s) changes between renders. The seed is also the cache key, so toggling between mode "redacted" → "surrogate" → "redacted" round-trips through cache and is instant.

---

## 3. Export tab

Replaces today's `DatasetExportBar`-driven flow. The tab is a single screen with three sections that activate sequentially.

### 3.1 Configure (top)

```
Scope:   ( ) all files       (•) resolved only       N files
Output:  ( ) annotated       ( ) redacted            ( ) surrogate
Seed:    [_______]                                    (only when surrogate)
                                                      [Generate Output]
```

- **Scope:** persisted as `lastExportScope` on the production store (already exists).
- **Output type:** persisted as the dataset's `exportOutputType` default (already exists), overridable per export.
- **Seed:** per-export. Defaults to the dataset's last-used seed if any, otherwise a fresh deterministic value. Only meaningful when output type = surrogate; field is hidden otherwise.
- **Generate Output:** disabled while a batch is running; otherwise primary CTA.

### 3.2 Generate (middle, while running)

Pressing Generate fires one batch. For each in-scope file:

```
inferText output → /process/redact (mode + seed) → cache result by (textHash, annotationsHash, mode, seed)
```

Concurrency `CONCURRENCY = 4`, matching `useBatchDetect`. Progress UI: `done/total` plus a per-file row state in the preview list (`pending → running → ok | error`). Cancellable.

Annotated mode skips the API entirely — annotations are already on the file, output is the file's current `annotations` array.

### 3.3 Review (bottom, after generation)

Two display modes share the same data:

1. **Pager**: file list rail on the left + single-file inspector on the right (renders the produced output via `SpanHighlighter` for annotated/surrogate, plain for redacted). `[` / `]` page through; `R` jumps to next errored file. Optional, not required for export.
2. **Flat list**: collapse-by-default rows, click to expand any one. For datasets where spot-checking 3-5 files is enough.

Either way, the **action verbs** sit at the top of the Review section and consume the cached batch results:

- **Download**: existing client-side flow (zip of JSONL / CoNLL / etc.). Format picker as today.
- **Register as dataset**: posts to `/datasets/import/jsonl` (or `/datasets/ingest-from-pipeline` for non-JSONL bundles) so the produced dataset becomes a backend corpus, ready for re-annotation in the Playground UI.

The user can hit either action without paging through anything. Paging is purely review-of-confidence.

### 3.4 Staleness

If the user goes back to Annotate after Generate and edits a span, the cached batch becomes stale for that file:

- A **stale chip** appears at the batch level: "12 of 23 files have changed since this batch was generated."
- Download and Register show a confirmation: "Some files have unsaved annotation changes. Use stale outputs anyway?" with primary action **Regenerate**.
- The Regenerate button at the top of Review re-runs only the changed files (the cache hit on unchanged files makes this cheap).

Per-file stale signals also surface as chips in the file rail.

### 3.5 Partial failures

Within one batch, a 422 or 500 on `/process/redact` for a specific file marks that row red in the pager and excludes the file from Download / Register by default. The batch as a whole still succeeds for the rest. A "Retry failed" button regenerates only the failed subset.

---

## 4. Cross-cutting

### 4.1 Client output cache

A new module — `lib/outputCache.ts`. Memory-only (no IndexedDB persist). Map keyed by:

```ts
type OutputKey = `${textHash}|${annotationsHash}|${mode}|${seed}`;
```

`textHash` and `annotationsHash` reuse today's `hashSourceText` and `hashAnnotations` helpers (the only survivors from `savedOutput.ts`). Eviction is dataset-scoped — when a dataset is unloaded or files removed, we clear its keys; otherwise it sits for the session.

Both the Annotate preview column and the Export tab go through this cache. Re-toggling preview mode, undoing an edit, regenerating a batch after one-file edits — all cache hits.

### 4.2 Surrogate seed model

- `DatasetFile.surrogateSeed?: string` — per-file, set when the user types into the Annotate preview seed input.
- `Dataset.defaultSurrogateSeed?: string` — per-dataset, used when generating the Export batch and the file has no override.
- Default initialization: `defaultSurrogateSeed = makeId('seed')` at dataset creation; per-file falls back to dataset default until edited.

### 4.3 Persisted-store changes

Additive plus one removal:

| Field | Change |
|-------|--------|
| `DatasetFile.savedOutput` | **deleted** |
| `DatasetFile.surrogateText`, `annotationsOnSurrogate` | **deleted** (already deprecated) |
| `DatasetFile.surrogateSeed` | added (optional string) |
| `Dataset.defaultSurrogateSeed` | added (optional string) |
| `Dataset.exportOutputType` | unchanged (still UI default) |
| `Dataset.autoResolveOverlaps` | unchanged (orthogonal) |

Persist version bumps to **v4**. Migration drops `savedOutput` / `surrogateText` / `annotationsOnSurrogate` silently. They were UI snapshots, not source-of-truth — losing them is acceptable; the user re-derives by hitting Generate.

---

## 5. What gets deleted

Files removed:

- `frontend-production/src/components/shared/SaveOutputButton.tsx`
- `frontend-production/src/components/production/savedOutput.ts` — except `hashSourceText` / `hashAnnotations`, which move to `lib/outputCache.ts`.

Components simplified:

- `DocumentReviewer.tsx` — drop the `ReviewerDualPane` invocation, the right pane render, and all `savedOutput` / `previewBytes` / `isSavedOutputStale` references. Add the Preview column. Drop the document-header Flag and Resolved buttons (move to file-row chips).
- `SpanEditor.tsx` — drop the `saveControl` prop and the conditional render for it. (The conflict-resolution UI from the prior milestone stays.)
- `DatasetExportBar.tsx` — replaced by the new Export tab. Existing format-pickers and download helpers are reused inside the new screen.
- `store.ts` — remove `SavedOutput`, `SavedOutputMode`, `SaveFileOutput`, `clearFileOutput`, `replaceFileAnnotations`'s `surrogateText` / `annotationsOnSurrogate` / `autoResolve` fields stay (autoResolve is orthogonal). Remove the legacy migrations that fed those.

Keep, but rename or relocate:

- `hashSourceText`, `hashAnnotations` → `lib/outputCache.ts`.
- `ReviewerDualPane` → delete if no other consumer; otherwise keep for the Export tab pager.

---

## 6. Implementation sketch

| Piece | Action |
|-------|--------|
| `lib/outputCache.ts` (new) | Memory cache + hash helpers (moved from `savedOutput.ts`). API: `get(key)`, `set(key, value)`, `invalidateForFile(fileId)`, `invalidateForDataset(datasetId)`. |
| `components/production/PreviewColumn.tsx` (new) | The collapsible preview. Owns mode toggle, seed input, debounced fetch, cache lookup, error/loading state. |
| `components/production/DocumentReviewer.tsx` | Drop right pane + save UI. Mount `PreviewColumn` to the right of the spans sidebar (or to the right of source — see open decisions). Drop header Flag / Resolved buttons. |
| `components/production/DatasetFileList.tsx` | Add per-row Flag and Resolved chips. (`useFileListKeybinds` already wires shortcuts.) |
| `components/production/steps/ExportStep.tsx` (new) | Replaces the export sub-flow inside `DatasetExportBar`. Configure → Generate → Review → Download / Register. |
| `components/production/useBatchGenerate.ts` (new) | Mirrors `useBatchDetect`: queue, concurrency, cancel, progress, per-file status; writes results to `outputCache`. |
| `components/production/store.ts` | Add `surrogateSeed` (file) and `defaultSurrogateSeed` (dataset). Remove `SavedOutput` shape and helpers. Bump persist version to v4 + migrate. |
| `components/production/savedOutput.ts` | **Deleted**, after moving the two hash functions. |
| `components/shared/SaveOutputButton.tsx` | **Deleted**. |
| Routing | Rename the existing `/datasets/:id/review` route to `/datasets/:id/annotate`. The export step gets `/datasets/:id/export` (already exists in some form). |

---

## 7. Open decisions (resolve during implementation)

1. **Preview column placement.** `[ Source | Spans | Preview ]` keeps spans tight against source (where reviewers click between them) and preview as a passive observer on the far edge. `[ Source | Preview | Spans ]` puts preview between editing surface and the span list, which is awkward. Default: **source-spans-preview**. Confirm during build.
2. **Preview column resize.** Fixed split (50/50 of source-area when shown), or user-resizable splitter? Default: **fixed**, add splitter only if reviewers ask.
3. **Seed input UX.** Free text field, "regenerate" dice button, or both? Default: **free text + dice button** (dice rolls a fresh deterministic seed).
4. **Pager vs. flat list in Export Review.** Ship pager only; add flat list later if reviewers want at-a-glance scanning. Default: **pager v1**.
5. **Header Flag / Resolved migration to file-row chips.** Need to decide whether the chips are click-to-toggle or button-with-icon (consistent with the Detect step's existing chips). Default: **click-to-toggle, same style as Detect**.

---

## 8. Acceptance / testing

`frontend-production` has no test runner; verification is the same shape as the overlap-conflict redesign:

1. **Type check + build:** `tsc -b && vite build`.
2. **Manual smoke (Annotate):**
   - Default layout: source + spans only; preview pill visible at right edge.
   - Click pill: preview column appears, defaults to redacted, populated within ~500 ms.
   - Toggle to surrogate: same text, surrogate values fill in. Note seed value.
   - Edit a span: preview re-renders ~300 ms after edit; surrogate values for untouched spans remain identical (seed working).
   - Toggle off, on: preview restores instantly (cache).
3. **Manual smoke (Export):**
   - Configure scope=resolved + output=surrogate + seed=42 → Generate. Progress UI ticks through files.
   - Pager: page through 3 files, all populated.
   - Hit Download (JSONL): zip contains all files in scope.
   - Go back to Annotate, edit a span, return to Export: stale chip on that file; Regenerate refreshes only it.
   - Hit Register as dataset: new corpus appears in the playground UI.
4. **Migration smoke:** load a v3 IndexedDB snapshot with `savedOutput` populated; verify it migrates cleanly to v4 with no errors and `savedOutput` gone.

---

## Summary

**Annotate is annotation; Export is artifacts.** The persistence shape collapses to the file's current `annotations`; everything else is derived. A single client-side cache, keyed by `(textHash, annotationsHash, mode, seed)`, makes both the Annotate preview column and the Export batch responsive without any user-facing notion of "saved" or "stale snapshot." Surrogate determinism comes from a per-file seed that doubles as the cache key.
