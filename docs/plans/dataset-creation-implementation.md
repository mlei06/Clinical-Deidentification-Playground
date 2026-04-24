# Implementation roadmap: NER dataset creation + Production UI workbench

Concrete, sequenced execution plan for the two existing design documents:

- [plans/ner-dataset-creation.md](ner-dataset-creation.md) — backend/CLI/API contracts.
- [design/production-ui-assisted-ner-datasets.md](../design/production-ui-assisted-ner-datasets.md) — Production UI workbench.

This is the **what-gets-written-when** companion to those docs: file paths, function signatures, test fixtures, and ordering. Milestones are numbered so a branch/PR can reference `IMPL-M{n}`.

**Plan maintenance:** Prefer **module / class / function names** over line numbers in this file—line numbers drift on every edit.

Current gap (baseline for this plan):

- **Design doc** ([production-ui-assisted-ner-datasets.md](../design/production-ui-assisted-ner-datasets.md)) — Production *workbench* UI: design M0/M1/M2 done; design **M3** (`surrogate_annotated`) is UI-stubbed waiting on backend; design **M4** (virtualization, keyboard shortcuts) partial (filter chips only). This is **not** the same numbering as IMPL-M* below.
- **[ner-dataset-creation.md](ner-dataset-creation.md)** — backend phases **A, B, C-minimal, D, E** unstarted in code; the large **Playground dataset transform / workbench UI** work (if present in tree) is parallel and not a substitute for those backend phases.

---

## Guiding constraints

- **No new storage layer.** Canonical corpus stays `data/corpora/{name}/corpus.jsonl` as `AnnotatedDocument` JSON lines; audit stays in SQLite.
- **Admin vs inference scope** — all new admin routes use `require_admin`; no new anonymous surface.
- **Pure functions first.** Ship the surrogate alignment algorithm and the ingest converter as library functions with unit tests before wiring API/UI.
- **One pipe-type contract** — don't mutate pipeline JSON shape; ingest-from-pipeline reuses existing pipe-chain resolution.
- **Tests land in the same PR as the code they cover.** New integration tests use `tmp_path` + the `client` fixture (`tests/conftest.py`).

---

## IMPL-M1 — Annotated JSONL export (Phase B)

**Why first:** smallest, unblocks downstream consumers, shakes out the export plumbing before bigger phases.

### Backend

- `src/clinical_deid/training_export.py` — add `to_annotated_jsonl(docs) -> str` and `export_annotated_jsonl(docs, output_dir, filename=None) -> Path`. Reuses `AnnotatedDocument.model_dump_json()` (one JSON object per line). Update the module docstring. Wire into `export_training_data(...)` alongside existing formats (same pattern as HuggingFace JSONL defaulting to `train.jsonl` unless `filename` is set).
- `src/clinical_deid/api/routers/datasets.py` — on `ExportTrainingRequest`, widen `format` literal to include `"jsonl"`:
  ```python
  format: Literal["conll", "spacy", "huggingface", "brat", "jsonl"] = "conll"
  ```
  Branch in `export_dataset` to `export_annotated_jsonl(...)` (same style as existing `brat` / training branches).
- `src/clinical_deid/cli.py` — the `dataset export` command: add `"jsonl"` to the `click.Choice` for `--format`, document in the command docstring.

### Tests

- `tests/test_training_export.py` — add `test_annotated_jsonl_roundtrip` using a fixture of 2 docs; parse lines back via `AnnotatedDocument.model_validate_json` and assert equality.
- `tests/test_datasets_api.py` — `test_export_annotated_jsonl` hits `POST /datasets/{name}/export` with `{"format":"jsonl"}`; assert a file is written under `get_settings().exports_dir / {name} /` with the same default filename behavior as `export_training_data` for that format (today HuggingFace JSONL uses `train.jsonl` unless overridden) and line count matches the dataset.

### Docs

- `docs/data-ingestion.md` — add one-paragraph "Annotated JSONL export" section with CLI + API examples.
- `CLAUDE.md` — bump the `POST /datasets/{name}/export` row to list `jsonl`.

**Definition of done:** `clinical-deid dataset export NAME -o <dir> --format jsonl` writes an annotated JSONL file under the configured **exports** directory; that file can be **registered** again with `POST /datasets` using `format: "jsonl"` and `data_path` pointing at the export (same contract as the existing JSONL register path in `register_new_dataset` / `RegisterDatasetRequest`). If the on-disk format must match the **training** JSONL path exactly, add a one-line note in the PR that imports `import_jsonl_dataset` / loader expectations.

---

## IMPL-M2 — Corpus pipeline bridge (Phase A)

**Why second:** turns raw `.txt` folders into registered datasets in one step — the on-ramp that makes the rest of the workflow meaningful.

### Library

- **New file:** `src/clinical_deid/ingest/from_batch.py`
  - `batch_to_annotated_docs(inputs: Iterable[tuple[str, str]], *, pipeline: Pipe) -> Iterator[AnnotatedDocument]` — takes `(doc_id, text)` pairs, runs the pipe chain, yields `AnnotatedDocument` records.
  - `ingest_paths_with_pipeline(paths: Sequence[Path], *, pipeline_name: str, output_mode: Literal["annotated"]="annotated") -> Iterator[AnnotatedDocument]` — iterates `.txt` / `.jsonl` files, calls `batch_to_annotated_docs`. Builds the pipeline via existing `pipeline_store.load_pipeline` + `registry.build_pipeline` — reuse, do not duplicate.
  - `_iter_text_inputs(path: Path)` helper — yields `(stem, text)` for each `.txt` or each JSONL line (honor `document.text` or `text` like `DatasetFileList.parseFile`).
- Reuse `ingest/sink.py::write_annotated_corpus(..., jsonl=path)` for on-disk materialization.

### CLI

- `src/clinical_deid/cli.py` — new `clinical-deid dataset ingest-run`:
  ```
  dataset ingest-run
    --input PATH            (required; dir of .txt, single .txt, or .jsonl)
    --pipeline NAME         (required; saved pipeline on disk)
    --output-name NAME      (mutually-exclusive with --output-jsonl; registers dataset)
    --output-jsonl PATH     (one-off file; no registration)
    --on-error {skip,stop}  (default skip)
  ```
  - When `--output-name`: write to `CORPORA_DIR/{name}/corpus.jsonl` + manifest via `dataset_store.commit_colocated_dataset`.
  - Emits `audit` record with `command="dataset_ingest"`, `pipeline_name`, `doc_count`, `span_count`.

### API

- **New endpoint:** `POST /datasets/ingest-from-pipeline` (admin-only).
  - Request:
    ```json
    {
      "source_path": "corpora_subdir/raw_txts",
      "pipeline_name": "fast",
      "output_name": "raw_txts_fast_silver"
    }
    ```
  - **Security:** `source_path` is resolved **relative to `CORPORA_DIR`** and must not escape via `..`. Return 400 otherwise. Document the constraint in `docs/api.md`.
  - Reuse the library function; stream docs to JSONL; then call `refresh_analytics`.
  - Response: `{"name": "...", "document_count": N, "total_spans": M}`.
- `src/clinical_deid/api/schemas.py` — new pydantic models `IngestFromPipelineRequest`, `IngestFromPipelineResponse`.

### Tests

- `tests/test_from_batch.py` — unit tests for the converter using a stub pipeline (`lambda doc: AnnotatedDocument(document=doc.document, spans=[EntitySpan(start=0, end=4, label="NAME")])`); verify span propagation and metadata preservation.
- `tests/test_datasets_api.py::test_ingest_from_pipeline` — write two `.txt` files under `tmp_path / "corpora" / "raw"`, POST, assert new dataset visible in `GET /datasets`, `corpus.jsonl` exists with 2 lines.
- `tests/test_datasets_api.py::test_ingest_from_pipeline_path_escape_rejected` — passes `../../etc/passwd`, asserts 400.

### Docs

- `docs/data-ingestion.md` — new "Ingest raw text through a pipeline" section.
- `docs/api.md` — add the new POST route under Datasets.
- `CLAUDE.md` / `PROJECT_OVERVIEW.md` / `README.md` — add endpoint row.

**Definition of done:** from a cold `data/corpora/`, two commands (`clinical-deid pipeline create` + `dataset ingest-run`) produce a registered dataset visible in the Playground Datasets UI.

---

## IMPL-M3 — Document-level edit endpoint (Phase C-minimal)

**Why third:** smallest piece of registry write-back — supports Playground gold-correction without touching the Production UI.

### API

- `src/clinical_deid/api/routers/datasets.py` — add:
  - `PUT /datasets/{name}/documents/{doc_id}`
    - Request body: `{ "spans": [...EntitySpan...], "text": "optional override" }`.
    - If `text` provided: validate every span start/end lies within it; reject 422 on mismatch.
    - If `text` absent: spans validated against existing `document.text`.
    - Rewrite `corpus.jsonl` atomically (write temp + `Path.replace`) — keep the rest of the file unchanged.
    - Bump `dataset.json` `updated_at`; recompute analytics.
- **Concurrency (v1):** document last-write-wins: two concurrent `PUT`s for the same `doc_id` can race; no ETag/optimistic locking in M3. If product needs conflict detection, add a `revision` or `if_match_etag` field in a later milestone.
- Optional, deferrable to IMPL-M8: `POST /datasets/{name}/documents/batch-patch` (list of per-doc patches applied in a single rewrite).

### Library

- `src/clinical_deid/dataset_store.py` — new `update_document(ds_dir, name, doc_id, *, spans, text=None) -> AnnotatedDocument`. Single function; keep the file-rewrite logic out of the router.

### Tests

- `tests/test_datasets_api.py::test_put_document_replaces_spans` — register fixture, PUT, re-GET, assert spans updated.
- `tests/test_datasets_api.py::test_put_document_rejects_out_of_range_span` — asserts 422.
- `tests/test_datasets_api.py::test_put_document_missing_id_returns_404`.

### Frontend (Playground only — not Production UI yet)

- `frontend/src/api/datasets.ts` — `updateDocument(name, doc_id, body)`.
- `frontend/src/components/datasets/DocumentBrowser.tsx` — add lightweight edit-mode wired to the new endpoint; **scope-limit** to per-span label change + save button. No full editor redesign in this milestone.

**Definition of done:** admin can open a document in Playground Datasets, change a label, save, and see the change persist in `corpus.jsonl`.

---

## IMPL-M4 — Surrogate alignment algorithm (Phase D1 + D4)

**Why fourth:** highest technical risk — ship the pure-function + tests before wiring API/UI.

### Library

- **Refactor target:** `src/clinical_deid/api/services/inference.py::apply_output_mode` (surrogate branch).
- **New module:** `src/clinical_deid/pipes/surrogate/align.py`
  - ```python
    def surrogate_text_with_spans(
        original_text: str,
        spans: list[EntitySpan],
        *,
        seed: int | None = None,
        consistency: bool = True,
    ) -> tuple[str, list[EntitySpan]]:
        ...
    ```
  - **Algorithm** (documented choice): compute replacements left-to-right using a cumulative offset map — simpler to reason about than the right-to-left shift approach, only one pass. Reject overlapping spans with `ValueError` (caller pre-resolves via `resolve_spans`).
  - Reuses existing `SurrogateGenerator` from `pipes/surrogate/strategies.py` (seed + consistency already wired).
- `apply_output_mode` delegates to the new function; throws away the returned spans for the existing `output_mode=surrogate` code path so the response contract is unchanged.

### Tests — golden fixtures

- **New file:** `tests/test_surrogate_align.py`
  - `test_deterministic_seed` — identical `(text, spans, seed)` → identical output (string and spans).
  - `test_spans_point_to_surrogate_entities` — for each returned span, `surrogate_text[s.start:s.end]` equals the replacement string.
  - `test_adjacent_spans` — `[NAME][DATE]` back-to-back, no gap.
  - `test_empty_spans` — original text returned, zero spans.
  - `test_surrogate_longer_than_original` / `test_surrogate_shorter_than_original`.
  - `test_overlapping_spans_rejected` — raises `ValueError`.
  - `test_consistency_flag` — same original entity string maps to same surrogate across a document.

**Definition of done:** algorithm ships behind a feature flag (`include_surrogate_spans` request param, defaults false) — zero change to existing `output_mode=surrogate` callers, full test coverage for span math.

---

## IMPL-M5 — Surrogate API + export (Phase D2 + D3)

**Depends on IMPL-M4.**

### API — inference

- `src/clinical_deid/api/schemas.py::ProcessRequest` — add optional `include_surrogate_spans: bool = False`.
- `src/clinical_deid/api/schemas.py::ProcessResponse` — add optional `surrogate_text: str | None`, `surrogate_spans: list[EntitySpanResponse] | None`.
- `src/clinical_deid/api/services/inference.py::process_single` — when flag set **and** `output_mode == surrogate`, call `surrogate_text_with_spans` and populate the new fields. `redacted_text` keeps its existing semantics (the surrogate string) for backward compat.

### API — dataset export

- `src/clinical_deid/api/routers/datasets.py::ExportTrainingRequest` — add `target_text: Literal["original", "surrogate"] = "original"` and `surrogate_seed: int | None = None`.
- When `target_text == "surrogate"`:
  1. Load docs.
  2. For each doc, run `surrogate_text_with_spans` after **the same** span merge / resolution path `export_training_data` uses today (do not introduce a second merge—call shared helper or re-export a single `prepare_docs_for_export` in `training_export` to avoid drift).
  3. Emit BRAT / JSONL / CoNLL on the transformed docs.
- Error modes:
  - `output_mode` incompatible with `target_text` combos — 422 with explanation.
  - Overlapping spans that fail resolution — 422 with list of offending doc IDs.

### CLI

- `clinical-deid dataset export --target-text surrogate --seed 42` mirror-flag.

### Tests

- `tests/test_inference_api.py::test_process_include_surrogate_spans`.
- `tests/test_datasets_api.py::test_export_surrogate_brat_round_trip` — export a fixture, re-import the BRAT, diff spans.
- `tests/test_datasets_api.py::test_export_surrogate_jsonl_line_shape`.

### Docs

- `docs/api.md` — note the new request/response fields under Process and Datasets.
- `docs/data-ingestion.md` — short "Surrogate-aligned exports" subsection.

**Definition of done:** `POST /datasets/{name}/export` with `{"format":"jsonl","target_text":"surrogate","seed":42}` produces a file where every span points at the surrogate substring.

---

## IMPL-M6 — Production UI: wire `surrogate_annotated` to backend (design spec M3)

**Depends on IMPL-M5.**

### Frontend

- `frontend-production/src/api/production.ts` — extend `inferText` or add a sibling `inferTextWithSurrogate` that passes `include_surrogate_spans=true`.
- `frontend-production/src/components/production/useBatchDetect.ts` — when the active dataset's `exportOutputType === 'surrogate_annotated'`, run the surrogate-aware call and cache `surrogateText` / `annotationsOnSurrogate` on the file (store already has the fields — they are currently always cleared).
- `frontend-production/src/components/production/DatasetExportBar.tsx::buildLine` — for `surrogate_annotated`, stop emitting the `surrogate_alignment: "unavailable"` stub; use the cached `surrogateText` + aligned spans. Keep the audit-friendly `metadata.original_text` / `original_spans` as documented in §5.3.
- `frontend-production/src/components/production/DocumentReviewer.tsx` — optional "Preview surrogate" toggle (read-only) so reviewers can see the aligned output before export.

### Tests

- `frontend-production/src/components/production/__tests__/DatasetExportBar.test.tsx` (new) — snapshot the three export types against a fixture dataset.

**Definition of done:** switching `exportOutputType` to `surrogate_annotated`, re-running detection, and exporting produces a JSONL corpus whose `text` is the surrogate and whose `spans` point at the surrogate.

---

## IMPL-M7 — Production UI: M4 polish (virtualization + keyboard)

**Independent of backend work — can be parallelized after IMPL-M2.**

### Virtualization

- `frontend-production/src/components/production/DatasetFileList.tsx` — wrap the `<ul>` in `@tanstack/react-virtual`. Threshold: enable virtual scrolling once `visible.length > 200`; below that, keep the flat list (simpler DOM, fewer layout bugs). Add the dep to `frontend-production/package.json`.

### Keyboard shortcuts

- **New hook:** `frontend-production/src/components/production/useFileListKeybinds.ts`
  - `↑` / `↓` — move `currentFileId` within `visible`.
  - `J` / `K` — jump to next / previous **unresolved** file.
  - `N` — jump to next `detectionStatus === "error"`.
  - `R` — toggle `resolved` on current file.
  - Respect focus: shortcuts only active when the workbench root has focus **and** the active element is not an `input`, `textarea`, `select`, or `contenteditable` (so single-letter keys don’t fire while searching or editing notes).
- Wire via `useEffect` attached to the workbench container in `ProductionView.tsx`.
- Cheat-sheet tooltip in the header (`?` key opens a modal listing the shortcuts).

### Tests

- Vitest + `@testing-library/react` for the keybind hook: dispatch keydown events on a mock DOM and assert store calls.

**Definition of done:** 1k-file dataset scrolls smoothly (> 55fps observed by React profiler), keyboard power-user can resolve 10 files without mouse.

---

## IMPL-M8 — Hardening (Phase E)

**Last — after all feature work lands.**

### Observability

- `src/clinical_deid/audit.py` — add `service_type` constants: `"dataset_ingest"`, `"dataset_export_surrogate"`. Wire into the new endpoints.
- **Audit UIs (Playground + production):** grep for any **hard-coded** `source` / `command` allowlists. If the log table or filters assume a closed set, extend them so new `command` / `source` values still display; otherwise “no code change” is not guaranteed.

### Limits

- `src/clinical_deid/api/schemas.py` — `IngestFromPipelineRequest` gets an optional `max_documents: int = 10_000`; enforce in router. Document in `docs/api.md#request-limits`.
- Streaming JSONL read for `ingest_paths_with_pipeline` (don't materialize all docs in memory).

### Security

- Round-trip test that `source_path` cannot escape `CORPORA_DIR` (already in IMPL-M2 tests; expand to cover symlinks).
- Document in `docs/configuration.md` under "Storage paths" that the ingest endpoint requires files to live under `CORPORA_DIR`.

### Batch document patch

- Implement the deferred `POST /datasets/{name}/documents/batch-patch` from IMPL-M3 if reviewer workflows need it — revisit after IMPL-M6 dogfood.

### Docs sweep

- `docs/ui.md` — document keyboard shortcuts, surrogate preview, virtualization caps.
- `CLAUDE.md` "What's not built yet" — remove the NER dataset creation bullet once IMPL-M1 through IMPL-M6 land.

---

## Suggested branch/PR layout

One PR per IMPL milestone. Small milestones (M1, M3) land in a single PR; M2, M4, M5 warrant their own PRs because they add library + API + tests together.

**Independence:** IMPL-M3 (document `PUT`) does **not** depend on IMPL-M1/M2; it can ship in parallel once scoped.

| Milestone | Approx. diff | Depends on |
|---|---|---|
| IMPL-M1 Annotated JSONL export | ~150 LOC + tests | — |
| IMPL-M2 Corpus pipeline bridge | ~400 LOC + tests | M1 (not hard; nice for testing) |
| IMPL-M3 Document edit endpoint | ~200 LOC + tests | — (parallel with M1/M2 allowed) |
| IMPL-M4 Surrogate alignment algo | ~250 LOC + heavy tests | — |
| IMPL-M5 Surrogate API + export | ~300 LOC + tests | M4 |
| IMPL-M6 Production UI surrogate wiring | ~200 LOC (mostly TS) | M5 |
| IMPL-M7 Virtualization + keyboard | ~300 LOC (TS only) | — |
| IMPL-M8 Hardening | docs + audit + limits | all above |

## Out of scope for this roadmap

- Active-learning sampling loops.
- BRAT round-trip editing from the desktop tool.
- Subword-level alignment for specific transformers (character spans are the contract).
- Multi-user collaborative editing in the Production UI.

## Open decisions to resolve before starting

1. **Ingest endpoint input source** (M2) — keep it path-based (`source_path` under `CORPORA_DIR`) or add a multipart upload variant? Recommendation: path-only in v1, add upload later only if operators ask.
2. **Surrogate algorithm order** (M4) — left-to-right cumulative offset vs right-to-left shift. Plan doc lists both; this roadmap picks **left-to-right / cumulative** for readability. Reversible if profiling surprises us.
3. **`output_mode=surrogate` response shape** (M5) — do we add `surrogate_spans` as an additive top-level field or gate it behind `include_surrogate_spans` only? Recommendation: additive, nullable, gated by flag — safest for existing clients.
4. **Virtualization threshold** (M7) — 200 items is a first guess; confirm with a demo dataset.
