# Implementation plan: finish general-NER / pluggable-schema WIP

This document is the **finish line** for the in-progress work that:

- Splits `datasets` and `cli` into packages (`api/routers/datasets/`, `cli/`).
- Introduces `clinical_deid.labels` (label spaces) and `clinical_deid.risk` (risk profiles) with `clinical_phi` vs `generic_pii`.
- Extends `Settings` with `label_space_name` and `risk_profile_name`.
- Domain uses `EntitySpan` and pluggable `LabelSpace` / `RiskProfile` (no generated label enum in `domain.py`).

It complements (does not replace) [dataset-creation-implementation.md](dataset-creation-implementation.md). Where that file names `api/routers/datasets.py` or `cli.py`, use the **package paths** above when implementing new features.

---

## Definition of done

- [x] **All tests pass** (`pytest`, optional `ruff check`) in a clean environment with `dev` extras.
- [x] **Console entry points work:** `clinical-deid --help` and subcommands resolve via `clinical_deid.cli:main` (already in `pyproject.toml`).
- [x] **Active risk profile** from settings is used by default in **API** and **CLI** evaluation paths (`eval/runner.py` uses `default_risk_profile()`; `POST /eval/run` and `clinical-deid eval` support per-run `risk_profile_name` / `--risk-profile` and persist `metrics.risk_profile_name`).
- [x] **Documented** env vars: `CLINICAL_DEID_LABEL_SPACE_NAME` / `CLINICAL_DEID_RISK_PROFILE_NAME` in [docs/configuration.md](../configuration.md), [CLAUDE.md](../../CLAUDE.md), and `.env.example` (aligned with `config.py`).
- [x] **No stray committed artifacts** under `**/__pycache__` (root `.gitignore` already has `__pycache__/`; verify `git status` before commit).
- [x] **New/changed code covered:** `tests/test_eval_runner_risk_profile.py` and extended `test_datasets_api` for eval; run full suite locally with `dev` extras.

---

## Phase 0 — Baseline and inventory (0.5–1 day)

1. **Run the suite** and capture failures. Fix import errors or rename mismatches from the package split first (anything that still imports deleted `datasets.py` / `cli.py` modules).
2. **Grep audit** (quick): `PHILabel` / `CLINICAL_PHI_RISK` / `get_settings().label_space` usage — list files that should respect `default_label_space()` / `default_risk_profile()` but do not yet.
3. **Align docs:** skim [docs/configuration.md](../configuration.md) and [CLAUDE.md](../../CLAUDE.md) against `src/clinical_deid/config.py` so env names and defaults match the code.

**Exit:** [x] Suite and audit complete; `PHILabel` / monolithic `datasets` / `cli` imports are gone; docs match `config.py`.

---

## Phase 1 — Wire `Settings` to evaluation (core WIP)

**Problem:** `label_space_name` and `risk_profile_name` exist on `Settings`, and `default_label_space()` / `default_risk_profile()` exist in `labels` / `risk`, but **`evaluate_pipeline` falls back to `CLINICAL_PHI_RISK`** when `risk_profile` is `None` (`eval/runner.py`), and **callers do not pass** the active profile.

**Tasks**

1. **`eval/runner.py`**
   - When both `risk_weights` and `risk_profile` are unset, set the default profile to **`default_risk_profile()`** from `clinical_deid.risk` (which reads `get_settings().risk_profile_name`) instead of importing `CLINICAL_PHI_RISK` only.
   - Keep behavior: explicit `risk_weights` still builds an ad-hoc `RiskProfile`; explicit `risk_profile` still wins over defaults.
2. **`api/routers/evaluation.py`**
   - After `result = evaluate_pipeline(pipe_chain, documents)`, the default should now follow server settings. Optionally add **optional** request fields `risk_profile_name: str | None` and/or `use_default_risk_profile: bool` for one-off evals without changing `CLINICAL_DEID_RISK_PROFILE_NAME` globally — only if you need per-run overrides; otherwise skip and rely on settings.
3. **`cli/root.py` (eval command)**
   - Mirror the API: either rely on the runner default (after step 1) or add `--risk-profile` to override the active profile for that invocation.
4. **Tests**
   - Add a test that sets `CLINICAL_DEID_RISK_PROFILE_NAME=generic_pii` (or uses `reset_settings()` + env), runs a **minimal** `evaluate_pipeline` (tiny gold/pred), and asserts risk-weighted recall uses the generic profile (e.g. different weighting than clinical for a controlled FN set), *or* assert the profile’s name is the configured one in the code path you expose.

**Exit:** [x] Toggling env changes eval default risk weighting; optional per-run `--risk-profile` / request body.

---

## Phase 2 — Label space consistency outside eval

**Goal:** Pipes, training, and ingest that **normalize** or **validate** labels should prefer the **active** `LabelSpace` where that is semantically “canonical schema for this deployment.”

**Tasks (prioritize by impact)**

1. **Detector / pipe label normalization** — Review `detector_label_mapping`, `regex_ner` / `surrogate` packs, and any code that still assumes a full clinical label list. Route normalization through `default_label_space().normalize` where appropriate, or document why a pipe is intentionally clinical-only.
2. **Pipeline UI / `output_label_space`** — Already partially addressed via `pipes/label_space.py` and pipeline enrichment; confirm **saved pipeline** metadata and validate-preview flows don’t assume `PHILabel` enum members only.
3. **Stray `PHILabel` usage** — Replace new code paths that import `PHILabel` for validation with string + `get_label_space` / `default_label_space` where the design calls for generic NER; keep `PHILabel` only for backward compatibility or clinical-only tools.

**Exit:** [x] [docs/configuration.md](../configuration.md) — “Domain packs” and “Label normalization” (including `generic_pii` + pipe pack caveats). `normalize_entity_spans` runs on **inference** only; for **eval**, gold and predicted labels are compared as stored so users align the corpus and pipeline (e.g. `label_mapper`). The clinical pack includes e.g. `TELEPHONE` as a first-class label for **inference** normalization when pipes emit that name.

**Status (implementation pass):** [docs/configuration.md](../configuration.md) documents pack alignment. `normalize_entity_spans` / `default_label_space().normalize` run on **inference** (`process_single`). **Eval** compares raw span labels. Pipe chains keep user `label_mapping` remaps until the inference boundary.

---

## Phase 3 — API / schema naming

**Done:** Process / inference JSON uses `EntitySpanResponse` and `label` strings; `PHILabel` / `PHISpan` names removed from the API and from `domain.py`.

---

## Phase 4 — Package split hygiene and release

1. **Stage the new tree:** `api/routers/datasets/`, `cli/`, `labels.py`, `risk.py`, `test_*.py`, and **removals** of `datasets.py` / `cli.py` in one logical commit or stacked PRs (split into smaller PRs if the diff is too large to review). *(Operator: `git add` / PR as appropriate.)*
2. [x] **`pip install -e .`** and scripts **`clinical-deid`**, **`clinical-deid-api`** — per [README.md](../../README.md) setup; entry points in `pyproject.toml`.
3. [x] **README** [README.md](../../README.md) — first paragraphs cover `generic_pii`, env vars, and `EntitySpan` / `EntitySpanResponse` naming (user-visible surface).

---

## Phase 5 — Parallel work from other plans

The **[dataset-creation-implementation.md](dataset-creation-implementation.md)** roadmap (annotated JSONL export, `ingest-run`, etc.) is **orthogonal**. When you implement those items:

- Touch **`api/routers/datasets/`** submodules (e.g. `by_name`, `list_and_import`) instead of a monolithic `datasets.py`.
- Touch **`cli/dataset.py`** (or the module that owns `dataset` subcommands) instead of `cli.py`.

No need to re-split packages again.

---

## Suggested order

| Order | Work | Status |
|------:|------|--------|
| 1 | Phase 0 (tests + inventory) | Done |
| 2 | Phase 1 (risk profile defaults in eval) | Done |
| 3 | Phase 4 (commit hygiene, README) | Done (README; git stage/PR is operator-side) |
| 4 | Phase 2 (label space at inference API) | Done (`normalize_entity_spans` on `process_single`, docs) |
| 5 | Phase 3 (neutral API names) | Done (`EntitySpanResponse`, `EntitySpan` only) |
| 6 | Phase 5 (dataset-creation roadmap) | Orthogonal; see [dataset-creation-implementation.md](dataset-creation-implementation.md) |

---

## Quick reference: key symbols

| Module | Role |
|--------|------|
| `clinical_deid.labels` | `LabelSpace`, `register_label_space`, `default_label_space()`, built-in packs |
| `clinical_deid.risk` | `RiskProfile`, `register_risk_profile`, `default_risk_profile()`, built-in profiles |
| `clinical_deid.config.Settings` | `label_space_name`, `risk_profile_name` |
| `clinical_deid.domain` | `Document`, `EntitySpan`, `AnnotatedDocument` |
| `clinical_deid.eval.runner.evaluate_pipeline` | Default risk profile from `default_risk_profile()` / settings |
