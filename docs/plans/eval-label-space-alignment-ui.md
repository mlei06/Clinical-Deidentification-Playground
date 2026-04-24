# Implementation plan: Evaluation UI & functionality

**Scope:** Better label alignment (Phase 5, below), **sampled eval runs** (corpus subset with fixed or random seed), **optional “save sample as new dataset”**, and a **per-document gold vs pred inspection** path where feasible.  
**Context:** `POST /eval/run` loads a full pipeline + annotated corpus, runs `evaluate_pipeline` (see `src/clinical_deid/eval/runner.py`), and persists **aggregate** metrics in `data/evaluations/*.json` via `eval_store.save_eval_result` — **not** per-document results today. The runner **does** compute `DocumentEvalResult` and sorts docs by strict F1; the CLI prints worst docs, but the HTTP API does not expose this yet.

**Related:** [configuration.md](../configuration.md) (inference label normalization vs eval), [api.md](../api.md), `docs/ui.md` (Evaluate page).

---

## Part A — Label-space alignment (existing phases 1–4, Phase 5 UX)

### Goal (summary)

Users see **raw** gold label set *A* vs pipeline symbolic `config.output_label_space` *B*, with a **non-blocking** warning when *A* and *B* misalign. Eval compares **string labels** on spans as returned by the pipeline; it does not apply `CLINICAL_DEID_LABEL_SPACE_NAME` at eval time.

**Definition of done (phases 1–4):** [x] — see section history below.

### Phase 1 — Evaluate UI: raw alignment panel — [x]

`frontend/src/components/evaluate/EvalLabelAlignment.tsx` + `EvalRunForm.tsx`.

### Phase 2 — Path-on-server — [x]

- **A** — Help copy when path empty / not `.jsonl`.
- **B** — `POST /datasets/preview-labels` + debounced fetch in the alignment component.

### Phase 3 — Inference disclaimer — [x]

`GET /health` — `label_space_name`, `risk_profile_name` in the alignment card.

### Phase 4 — Deep links — [x]

`/create?load=` + PipelineBuilder auto-load from alignment CTA.

### Phase 5 — Alignment panel UX refresh (clarity & de-duplication) — [x]

**Problem:** Full pipeline list (*B*) is confused with *B* \\ *A* (“only in pipeline”); the violet block duplicates information already implied by *B* ∩ *A* and *B* \\ *A*.

**Goals, proposed copy, implementation tasks, definition of done, and non-goals** — unchanged from the previous version of this section. Summary:

- Titles: **Gold only** (*A* \\ *B*), **In pipeline only** (not in this gold; *B* \\ *A*), **In both**, optional collapsed **All gold**, and **Full `output_label_space` (*n*)** behind `<details>`.
- **Counts** in every section header; **one-line** explainer under the title.
- **Files:** `EvalLabelAlignment.tsx` only; no API changes.

**Definition of done (Phase 5):**

- [x] Titles and explainer remove the “two pipeline spaces” confusion.
- [x] Counts on each partition; full *B* list collapsed by default.
- [x] `npm run build` (frontend) passes.

---

## Part B — Sampled evaluation (corpus mode + seed) — [x]

### User stories

- As a user, I choose a **registered dataset** or **path** (existing modes), then:
  - **Dataset splits (optional)** — comma-separated `metadata["split"]` filter, **first** in the form so the user defines *which* documents are in scope before any sample.
  - **Full vs sample** — **Run on full corpus** (current behavior), or **Run on a random sample** of *N* documents — **only after** splits are chosen (or left empty = all splits), with:
    - **Fixed seed** (reproducible subset: same *N* + same seed + same source ordering ⇒ same sample), or
    - **No fixed seed** (new random draw each run; API should return **`sample_seed_used`** so the run is auditable and optionally documented).
- **Backend order** (unchanged): load → optional `dataset_splits` filter → **then** sample. `sample_size` is validated against **`len(documents)` after splits**, not the raw corpus size.

### UI field order (Evaluate form)

1. Pipeline, dataset / path (existing).  
2. **`dataset_splits`** (optional) — “Include only these splits.”  
3. **`eval_mode`** — Full corpus **or** Random sample.  
4. **If sample:** `sample_size` (max = documents **after** splits; show this count when known, e.g. from `DatasetDetail` or a small preview endpoint).  
5. **If sample:** fixed seed vs random each run.  
6. Run, save-subset-as-dataset (Part C), etc.

Do **not** place sample size above splits — users must pick the split slice first so *N* and validation make sense.

### API design (proposed)

Extend `EvalRunRequest` in `src/clinical_deid/api/routers/evaluation.py` and TS `EvalRunRequest` in `frontend/src/api/types.ts`:

| Field | Type | Description |
|--------|------|-------------|
| `eval_mode` | `literal: "full" \| "sample"` | Default `"full"`. |
| `sample_size` | `int \| null` | Required when `eval_mode == "sample"`; `1 <= sample_size <= len(documents_after_split)`; cap server-side. |
| `sample_seed` | `int \| null` | If `full`, ignored. If `sample` and **null** → draw with OS RNG, **return** seed in response. If **integer** → deterministic sample (`random.Random(seed).sample` over document list **after** stable ordering — define **stable sort** by `document_id` or source order in JSONL to avoid env-dependent ordering). |
| (optional) | `str` | `sample_method`: default `"random_without_replacement"`; document if stratification is added later. |

Extend `EvalRunDetail` / stored JSON (and TS types) with **optional** metadata (only when `eval_mode == "sample"`):

- `eval_mode`, `sample_size`, `sample_seed_used` (the seed actually used, including when client omitted it).
- Optional: `sample_of_total: int` (document count after split, before sample) for display.

**Backend steps** (`run_evaluation` after `documents` is finalized):

1. If `eval_mode == "full"` → unchanged.
2. If `eval_mode == "sample"`:
   - Validate `sample_size` vs `len(documents)`.
   - Sort documents with a **documented** key (e.g. `doc.id` ascending) for reproducibility.
   - If `sample_seed` is `None` → `seed = secrets.randbits(64)` (or 32) and use `random.Random(seed).sample(docs, k)`.
   - Else → `Random(sample_seed).sample(docs, k)`.
3. Run `evaluate_pipeline` on the **sampled** list.
4. Persist metrics + new fields in the eval result file.

**Tests:** `tests/` — unit test sampling determinism (same seed + same list ⇒ same set of ids) and that split filter + sample order is as documented.

**Frontend — `EvalRunForm.tsx` (and any shared type exports):**

- Follow **UI field order** above: splits **above** full/sample; sample size **only after** the user has decided splits + sample mode.
- Radio or segmented control: **Full corpus** / **Random sample**.
- When sample: number input (min 1, max = document count **after** splits; hint from `DatasetDetail.document_count` only when no split filter, otherwise debounced `preview-labels` / dataset detail if API exposes split counts — *or* document “max = post-split” validated on server with a clear 422 if too large), toggle **Fixed seed** with optional numeric input, or **“Random each run”** (no seed).
- Show **returned** `sample_seed_used` in `EvalDashboard` when present.

**Non-goals (this phase):** Stratified sampling by label, streaming eval, or job queue for huge corpora.

---

## Part C — Save sample as a new registered dataset (optional) — [x]

### User story

After configuring a **sample** (or even after a run — usually **before/after run** as a explicit action), the user can **materialize** the current sample as a new JSONL-backed dataset under `data/corpora/{name}/` and register it (same as other imports) so future evals reference it by name without re-sampling.

### Feasibility

- **Reuses** existing write paths: `dataset_store` import/manifest, `import_jsonl_dataset` or a small **internal** helper: write `AnnotatedDocument` list to a temp JSONL under corpora, update `dataset.json` / index.
- **Security:** admin-only, same as other dataset mutations; validate name; reject path traversal.
- **Metadata:** mark provenance in `dataset.json` (e.g. `derived_from: "parent_name"`, `sample_seed`, `sample_size`, `created_at`).

### API (proposed)

**Option 1 (explicit endpoint):** `POST /datasets/subset` with body e.g. `{ "source": { "dataset_name" | "path" }, "document_ids": [...] }` or `{ "source", "sample_seed", "sample_size" }` — server re-reads source and writes subset (must match Part B’s ordering rules to pick same ids).

**Option 2 (tied to eval):** `POST /eval/run` with `save_sample_as: { "dataset_name": "my_sample_10k" }` — if `eval_mode == "sample"`, after eval **also** write the same document list to a new dataset. Simpler UX, one request.

**Recommendation:** Option 2 for the common path; Option 1 as a follow-up for “export subset without re-running eval” (re-derive from source + stored seed in eval JSON).

**Implementation tasks:** backend route + one integration test; Datasets list refresh; frontend checkbox + name field + error handling (name taken).

**Non-goals:** Upload to external S3, diff between two saved samples.

---

## Part D — Per-document inspection (gold vs predicted spans, paging) — [x]

### Current state

- `evaluate_pipeline` returns `EvalResult.document_results: list[DocumentEvalResult]` with FPs/FNs, metrics, and document id (`runner.py`).
- `save_eval_result` **does not** store `document_results` — only aggregate `metrics`, `document_count`, etc. (`eval_store.py`).
- The **web UI** does not show a worst-doc list (docs may claim it in marketing copy; CLI has it). **Reconstructing** gold vs pred for a **past** run from disk only is **not** possible without re-execution or expanded persistence.

### Feasibility matrix

| Approach | Pros | Cons |
|--------|------|------|
| **D1 — Include per-doc in API response, not in saved JSON** | Full gold/pred/FP/FN for current session; no disk growth. | **Lost** when user leaves page or re-opens run from list. |
| **D2 — Persist per-doc summary + ids in eval JSON** | Small files; list “worst docs”, sort, navigate by index. | **No** span text without re-fetch; need second step for detail. |
| **D3 — Persist per-doc with spans + text in eval JSON** | Full offline replay, historical debugging. | **Large** files; privacy / PHI duplication under `data/evaluations/`. |
| **D4 — `GET /eval/runs/{id}/recompute/{doc_id}`** | No huge storage. | Re-runs pipeline; **wrong** if pipeline or gold file changed. |
| **D5 — Hybrid: persist compact per-doc; fetch detail only for “current” run via extended POST** | Best balance for MVP. | Two code paths. |

**Recommendation (phased):**

1. **Phase 8a — Backend:** Add optional `include_per_document: bool` (default `false`) to `POST /eval/run`. When `true`, attach **`document_level`** to the in-memory `metrics` (or top-level) object with an array of items: at minimum `document_id`, `strict_f1` (or `metrics.strict.f1` mirror), and counts; optionally `gold_spans` / `pred_spans` / `false_positives` / `false_negatives` **when** a second flag `include_per_document_spans: bool` (default `false`) is set — with a **max_documents** or **size cap** guard in settings to limit response size. **Persist** only aggregate metrics + optional `document_index` (ids + scores only) if you want the run list to show “worst docs” without re-run — or persist nothing extra in v1 and only return in HTTP response.
2. **Phase 8b — Frontend:** `EvalDashboard` or new `EvalPerDocumentPanel`: sortable table, click row → **split view** reusing `SpanHighlighter`-style with two layers (gold vs pred) *if* spans are in the payload; else show metrics only and message “re-run with include spans to compare.”
3. **Phase 8c (optional):** Pager (prev/next) and keyboard shortcuts; optional **side-by-side** with shared scroll (trickier) vs stacked.

**Risks:** PHI in eval JSON and browser memory — add admin-only note and optional server setting `max_per_document_payload_mb`.

**Non-goals (initial):** Public share links, per-doc export, editing gold from eval.

---

## Cross-cutting checklist (when implementing Parts B–D)

- [ ] Update `docs/api.md` and OpenAPI/endpoint docstrings.
- [ ] `frontend` types + `EvalRunForm` / `EvalDashboard` / `evaluation.ts`.
- [ ] `tests/test_eval*.py` or new tests for sampling + (optional) per-doc response shape.
- [ ] `docs/ui.md` — Evaluate page bullets.

### Ordering suggestion

1. **Phase 5** (Part A) — no backend.  
2. **Part B** (sampling) — API + UI.  
3. **Part C** (save subset) — depends on B’s sampling semantics.  
4. **Part D** (per-doc) — 8a response shape first, then 8b UI; persistence policy decided explicitly.

---

## Related documents

- [dataset-creation-implementation.md](dataset-creation-implementation.md) — import/corpora layout (subset save aligns here).
- [finish-ner-wip-migration.md](finish-ner-wip-migration.md) — label/model context.

---

## References (code)

| Area | File(s) |
|------|---------|
| Eval HTTP | `src/clinical_deid/api/routers/evaluation.py` |
| Runner & per-doc | `src/clinical_deid/eval/runner.py` |
| Result FS store | `src/clinical_deid/eval_store.py` |
| Evaluate form | `frontend/src/components/evaluate/EvalRunForm.tsx` |
| Alignment UI | `frontend/src/components/evaluate/EvalLabelAlignment.tsx` |
| Dashboard | `frontend/src/components/evaluate/EvalDashboard.tsx` |
| Datasets / import | `src/clinical_deid/dataset_store.py`, `api/routers/datasets/*` |
