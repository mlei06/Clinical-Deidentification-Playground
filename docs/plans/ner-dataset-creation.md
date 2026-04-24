# Plan: NER dataset creation (high-priority use case)

## Goal

Enable clients to:

1. Ingest **large volumes of unannotated** clinical text (files or JSONL).
2. Run **configurable pipelines** to produce entity spans (NER / PHI labels).
3. **Review and correct** spans in the UI (or via API) at useful scale.
4. **Export** a gold or silver-standard corpus as **BRAT** and as **registry-native / HF-style JSONL** (`AnnotatedDocument` lines).
5. *(Advanced)* Produce **surrogate** clinical text for safe sharing while keeping **NER labels aligned** to the surrogate string (character offsets in the final text).

Today the building blocks exist (CLI batch, dataset registry, BRAT export, span editing in Inference / Production UIs) but the **end-to-end path is fragmented**, and **surrogate–span alignment is not implemented**.

---

## Guiding principles

- **Single source of truth** for on-disk datasets: `corpus.jsonl` as `AnnotatedDocument` JSON lines under `CLINICAL_DEID_CORPORA_DIR/{name}/`.
- **Spans are always explicit** (`start`, `end`, `label`) relative to **`document.text`** for that record; no silent mismatch between text and annotations.
- **Pipeline produces predictions**; **export and training** consume reviewed `AnnotatedDocument` only.
- **Surrogate alignment** is a **deterministic** function of `(original_text, spans, surrogate_seed, consistency)` so runs are reproducible.

---

## Phase A — Corpus pipeline bridge (backend + CLI)

**Objective:** Turn “folder of `.txt` + pipeline name” into a **registered dataset** (or a standalone `corpus.jsonl`) without manual JSON reshaping.

| Deliverable | Description |
|-------------|-------------|
| **Converter** | `ProcessedResult` → `AnnotatedDocument` (map `doc_id` → `document.id`, `original_text` → `document.text`, `spans` → `spans` with optional `confidence` / `source`). Lives in e.g. `src/clinical_deid/ingest/from_batch.py` or next to `export.py`. |
| **CLI** | `clinical-deid dataset ingest-run` (names TBD): `--input` (dir / jsonl), `--pipeline`, `--output-name` (register) or `--output-jsonl` (file only), `--output-mode annotated` (force spans on original text). Reuse `_build_pipeline` / batch loop from `cli.py`. |
| **API** | `POST /datasets/ingest-from-pipeline` (async-friendly spec below): body `{ "input_name": "optional-existing-dataset", "paths": ..., "pipeline_name": "...", "output_name": "...", "output_mode": "annotated" }` **or** multipart upload v1 deferred in favor of **server-side path** for trusted deploys only — document security implications. |
| **Idempotency / resume** | Optional: skip doc_ids already present in target manifest; log conflicts. |

**API shape (recommended):**

- **v1:** Server reads files only from **allowed directories** under `corpora_dir` (operator copies files there first) — avoids huge multipart in API process memory.
- **v2:** Optional authenticated **upload** endpoint that streams to temp dir then runs same job.

**Acceptance:** From a clean `data/corpora`, one command or one POST creates `{output_name}/corpus.jsonl` + `dataset.json`, visible in **Datasets** UI and exportable.

---

## Phase B — Export and format parity

**Objective:** Make BRAT + JSONL the obvious exports for this use case.

| Deliverable | Description |
|-------------|-------------|
| **`jsonl` export** | Extend `ExportTrainingRequest.format` with `jsonl` (or `annotated-jsonl`) that writes **one `AnnotatedDocument` per line** (same as internal store). Reuse `write_annotated_corpus(..., jsonl=path)`. |
| **CLI** | `clinical-deid dataset export NAME -o DIR --format jsonl` if not already present (today: conll, spacy, huggingface, brat only). |
| **Docs** | Short section in `docs/data-ingestion.md` or `datasets` UI help: “Predict → review → export BRAT / JSONL.” |

**Acceptance:** Export dropdown includes **Annotated JSONL**; exported file round-trips through **Register** (jsonl format).

---

## Phase C — Review at corpus scale (frontend + API)

**Objective:** Reduce reliance on single-document Inference paste for 100s–1000s of docs.

**Product owner for assisted NER dataset UX:** the **Production UI** (`frontend-production/`), **dataset-centric**: multiple named datasets, **per-dataset export output type** (`redacted` \| `annotated` \| `surrogate_annotated`), **selection-based detection** (one/many/all files, **any** allowed pipeline per run, **replace** existing annotations), **resolved** flag per file, ingest via paste/upload/batch, export **all files** or **resolved only** as homogeneous **JSONL**. See [design/production-ui-assisted-ner-datasets.md](../design/production-ui-assisted-ner-datasets.md).

| Track | Scope |
|-------|--------|
| **C-minimal** | **Playground Datasets** view: open document from preview → lightweight span editor → `PUT /datasets/{name}/documents/{doc_id}` (optional path for registry-backed gold data). |
| **C-full** | **Production UI** workbench: §4.1 detection UX, filters, virtualization, keyboard shortcuts, batch progress/cancel, **JSONL-only** corpus export (homogeneous `output_type` per dataset) — see [design spec](../design/production-ui-assisted-ner-datasets.md). Registry / CLI may still offer BRAT separately. |
| **Conflict policy** | Document whether overlapping spans from the model are **resolved before surrogate** (recommend: same `resolve_spans` / dedupe as Inference export path). |

**API additions (conceptual):**

- `GET /datasets/{name}/documents/{doc_id}` — already exists; ensure full `AnnotatedDocument`.
- `PUT /datasets/{name}/documents/{doc_id}` — replace `spans` (and optionally `text` with validation).
- Optional: `POST /datasets/{name}/documents/batch-patch` for bulk corrections.

**Acceptance:** Annotator can fix labels on **N documents** without re-running the pipeline; changes persist in registry and appear in BRAT/JSONL export.

---

## Phase D — Surrogate text + aligned NER spans (core new logic)

**Objective:** For each document, produce `surrogate_text` and `spans_surrogate` such that `surrogate_text[s.start:s.end]` is the surrogate entity string and labels match the reviewed (or predicted) entities.

### D1 — Core algorithm

- Refactor surrogate application into a **single function** used by `apply_output_mode` and by dataset export, e.g. `surrogate_text_with_spans(original_text, spans, *, seed, consistency) -> tuple[str, list[EntitySpan]]`.
- **Order:** Keep **right-to-left** replacement on **original** indices (same as today in `apply_output_mode`) so each replacement still slices the correct source substring from `original_text`.
- **Non-overlapping spans:** Require **resolved** spans (longest-non-overlapping or explicit policy). Overlaps: reject with 422 or run `resolve_spans` pipeline step before surrogate.
- **Output spans:** After each replacement at `(start, end)`, record the new span `(start, start + len(replacement))` in the **current** working string; when applying the next replacement to the **left**, **shift** already-recorded surrogate spans by `Δlength` for the segment just replaced (standard interval shift). Implement helper `shift_spans_after(spans, pivot_start, delta)` for spans with `start >= pivot_start`.

Alternatively, compute final positions in one pass after building the full string using a **cumulative offset map**; pick one implementation and unit-test heavily.

### D2 — Schema / export

- **Option 1 (recommended):** Add optional fields on export or a **parallel** export mode: `document.text` = surrogate string, `spans` = surrogate-space spans; include `metadata.original_text` and `metadata.spans_original` for audit.
- **Option 2:** Second file `corpus.surrogate.jsonl` alongside canonical `corpus.jsonl`.

### D3 — API / UI

- `POST /process/...` with `output_mode=surrogate` remains for redacted output string; optionally add `include_surrogate_spans=true` on process responses when we want training payloads (additive fields).
- Dataset-level: `POST /datasets/{name}/export` with `format=brat-surrogate` or `target_text=surrogate` flag.

### D4 — Tests

- Golden tests: fixed seed, known spans, assert string equality and span bounds.
- Edge cases: adjacent spans, empty span list, surrogate length &lt; / &gt; original length, Unicode combining characters (document behavior).

**Acceptance:** Given reviewed `AnnotatedDocument` on **original** clinical text, export produces BRAT (or JSONL) where **.txt matches .ann** on the **surrogate** file content.

---

## Phase E — Hardening and product polish

| Item | Notes |
|------|--------|
| **Performance** | Streaming JSONL read/write for ingest; optional worker pool for pipeline forward (watch SQLite audit if multi-worker). |
| **Limits** | Reuse / extend `MAX_BATCH_SIZE` and body caps for new batch endpoints; document max docs per ingest job. |
| **Security** | Ingest-from-path restricted to `corpora_dir` subpaths; no arbitrary filesystem read. |
| **Observability** | Audit log entries for `dataset_ingest` / `dataset_export_surrogate` with doc counts. |
| **Docs** | Update `CLAUDE.md` “What’s not built” → link this plan; add user-facing workflow in `PROJECT_OVERVIEW.md` or `docs/ui.md` only if you want public narrative. |

---

## Suggested sequencing

| Order | Phase | Rationale |
|-------|-------|-----------|
| 1 | **A** | Unblocks “real” datasets from batch runs; everything else hangs off registry. |
| 2 | **B** | Cheap; improves exporter UX immediately. |
| 3 | **D1–D2** | Highest technical risk; validate with tests before UI. |
| 4 | **C-minimal** | Makes review shippable without full queue. |
| 5 | **C-full** + **D3** | Product-grade annotator + surrogate export in UI. |
| 6 | **E** | After internal dogfood. |

---

## Out of scope (for this plan)

- **Active learning** loop (sample uncertain docs) — future.
- **BRAT import round-trip** editing in BRAT desktop only — export is enough for v1.
- **Token-level** (subword) alignment for specific transformers — character spans suffice; consumers can tokenize.

---

## Success metrics

- **Time to first BRAT corpus** from raw `.txt`: one CLI command or one wizard in UI, no hand-written JSONL.
- **100%** of exported BRAT pairs pass `brat_to_conll`-style text/ann consistency checks (internal validator).
- **Surrogate export:** zero off-by-one span errors on golden fixtures; documented seed for reproducibility.
