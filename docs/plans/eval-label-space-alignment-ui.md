# Implementation plan: eval label-space alignment (UI)

## Goal

Users **see raw** label sets — **dataset (gold) labels** vs **pipeline output label space** — and get a **non-blocking warning** when the sets do not line up. They **align manually**: edit the pipeline (e.g. add or adjust a final **`label_mapper`**), or change the gold corpus, so that **string labels match** what evaluation compares.

**Evaluation does not normalize labels.** `evaluate_pipeline` compares gold and predicted spans **as produced** (see `src/clinical_deid/eval/runner.py`). **Inference** (`POST /process/*`) still applies `normalize_entity_spans` / `default_label_space()` at the response boundary; that is separate from eval.

## Definition of done

- [x] With a **registered dataset** + **saved pipeline** selected on the Evaluate screen, the UI shows **raw** `DatasetDetail.labels` vs **raw** `config.output_label_space` from the pipeline, plus a clear **set diff** (only in gold, only in pipeline output, intersection).
- [x] If the sets differ, an **advisory** warning is shown; the user can still run eval. Copy explains: metrics use **exact string** equality on labels with gold — **fix alignment in the pipeline (or gold), not** via `CLINICAL_DEID_LABEL_SPACE_NAME` at eval time.
- [x] **Path-on-server** gold mode: info callout (register dataset for this panel) — see Phase 2.
- [x] No change to **eval math** in this plan (already raw); UI only.

## Current building blocks

| Source | What exists |
|--------|-------------|
| Dataset | `GET /datasets/{name}` → `DatasetDetail.labels` (from stored analytics / `dataset.json`). |
| Pipeline | `GET /pipelines/{name}` → `config.output_label_space` (from save/validate / `enrich_pipeline_config_with_label_space`). |
| Eval | `evaluate_pipeline` — **raw** `gold_doc.spans` and `pred_doc.spans` (no `normalize_entity_spans`). |

## Non-goals (v1)

- Applying **`LabelSpace.normalize`** to eval labels (server or UI “preview normalizer”) — users own alignment via **pipeline** / **corpus**.
- Automatic **suggested mapping** table.
- Requiring a registered dataset for every eval (path mode stays supported; alignment panel may be limited).

---

## Phase 1 — Evaluate UI: raw alignment panel (registered dataset) — [x]

**Where:** `frontend/src/components/evaluate/EvalLabelAlignment.tsx` + `EvalRunForm.tsx`.

**Exit:** Done.

---

## Phase 2 — Path-on-server gold mode — [x]

| Option | Work |
|--------|------|
| **A (minimal)** | Info callout: register dataset to compare — **done** in `EvalLabelAlignment` for `sourceMode === 'path'`. |
| **B** | `POST /datasets/preview-labels` — not implemented; optional. |

**Exit:** Path mode is not confusing relative to the raw-alignment story.

---

## Phase 3 — Show active `LabelSpace` for **inference** (disclaimer) — [x]

`GET /health` includes **`label_space_name`** and **`risk_profile_name`** (read-only, from `get_settings()`) in `src/clinical_deid/api/schemas.py` and `app.py`. The Evaluate panel shows an inference footnote from `useHealth()`.

---

## Phase 4 — Deep links and actions — [x]

- **“Open pipeline in builder”** → `/create?load={name}` with auto-load in `PipelineBuilder` (`useSearchParams` + `usePipelines` / `usePipeTypes`).
- Doc reference: `docs/pipes-and-pipelines.md` (copy in UI).

---

## Suggested order

| Order | Work | Status |
|------:|------|--------|
| 1 | Phase 1 | Done |
| 2 | Phase 2 (A) | Done |
| 3 | Phase 4 | Done |
| 4 | Phase 3 | Done |

## References

- `clinical_deid.eval.runner.evaluate_pipeline` — raw gold vs pred labels.
- `clinical_deid.api.services.inference.process_single` — `normalize_entity_spans` for **inference** only.
- [configuration.md](../configuration.md) — label normalization (inference vs eval).
- [`frontend/src/components/evaluate/EvalRunForm.tsx`](../../frontend/src/components/evaluate/EvalRunForm.tsx)

## Related

- [finish-ner-wip-migration.md](finish-ner-wip-migration.md)
- [dataset-creation-implementation.md](dataset-creation-implementation.md)
