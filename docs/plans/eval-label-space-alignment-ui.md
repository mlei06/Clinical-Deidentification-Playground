# Implementation plan: eval label-space alignment (UI)

## Goal

Users **see raw** label sets — **dataset (gold) labels** vs **pipeline output label space** — and get a **non-blocking warning** when the sets do not line up. They **align manually**: edit the pipeline (e.g. add or adjust a final **`label_mapper`**), or change the gold corpus, so that **string labels match** what evaluation compares.

**Evaluation does not normalize labels.** `evaluate_pipeline` compares gold and predicted spans **as produced** (see `src/clinical_deid/eval/runner.py`). **Inference** (`POST /process/*`) still applies `normalize_entity_spans` / `default_label_space()` at the response boundary; that is separate from eval.

## Definition of done

- [x] With a **registered dataset** + **saved pipeline** selected on the Evaluate screen, the UI shows **raw** `DatasetDetail.labels` vs **raw** `config.output_label_space` from the pipeline, plus a clear **set diff** (only in gold, only in pipeline output, intersection).
- [x] If the sets differ, an **advisory** warning is shown; the user can still run eval. Copy explains: metrics use **exact string** equality on labels with gold — **fix alignment in the pipeline (or gold), not** via `CLINICAL_DEID_LABEL_SPACE_NAME` at eval time.
- [x] **Path-on-server** gold: **Phase 2B** — `POST /datasets/preview-labels` + Evaluate panel scans gold labels for a `.jsonl` under the corpora root (same scoping as eval `dataset_path`).
- [x] No change to **eval math** in this plan; UI + one read-only API only.

## Current building blocks

| Source | What exists |
|--------|-------------|
| Dataset | `GET /datasets/{name}` → `DatasetDetail.labels` (from stored analytics / `dataset.json`). |
| Path gold | `POST /datasets/preview-labels` → `labels`, `document_count`, `resolved_path` (`dataset_store.unique_labels_for_jsonl_corpus`). |
| Pipeline | `GET /pipelines/{name}` → `config.output_label_space` (from save/validate / `enrich_pipeline_config_with_label_space`). |
| Eval | `evaluate_pipeline` — **raw** `gold_doc.spans` and `pred_doc.spans` (no `normalize_entity_spans`). |

## Non-goals (v1)

- Applying **`LabelSpace.normalize`** to eval labels (server or UI “preview normalizer”) — users own alignment via **pipeline** / **corpus**.
- Automatic **suggested mapping** table.

---

## Phase 1 — Evaluate UI: raw alignment panel — [x]

`frontend/src/components/evaluate/EvalLabelAlignment.tsx` + `EvalRunForm.tsx`.

## Phase 2 — Path-on-server — [x]

- **A** — Help copy when path empty / not `.jsonl`.
- **B** — `POST /datasets/preview-labels` in `api/routers/datasets/preview_labels.py`, debounced fetch in the alignment component.

## Phase 3 — Inference disclaimer — [x]

`GET /health` — `label_space_name`, `risk_profile_name`.

## Phase 4 — Deep links — [x]

`/create?load=` + PipelineBuilder auto-load.

## References

- `docs/api.md` — `POST /datasets/preview-labels`
- [configuration.md](../configuration.md) — label normalization (inference vs eval)
- [EvalRunForm.tsx](../../frontend/src/components/evaluate/EvalRunForm.tsx)

## Related

- [finish-ner-wip-migration.md](finish-ner-wip-migration.md)
- [dataset-creation-implementation.md](dataset-creation-implementation.md)
