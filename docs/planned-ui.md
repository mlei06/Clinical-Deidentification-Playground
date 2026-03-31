# Planned UI

The platform is designed API-first, but the eventual goal is a browser-based interface (htmx + Jinja2, no React build step) that wraps every major workflow. All UI features call the same Python library code and HTTP endpoints that the CLI and scripts use — no duplicate logic.

## Pipeline authoring

A visual editor for composing and versioning de-identification pipelines.

**What it does:**
- Browse the pipe catalog (`GET /pipelines/pipe-types`) with install status, descriptions, and role tags (detector, span transformer, redactor).
- Drag pipes into a sequential or parallel layout. Parallel blocks show a merge strategy selector (union, consensus, max_confidence, longest_non_overlapping).
- Each pipe renders a dynamic config form generated from its JSON Schema + `ui_*` hints — no per-pipe frontend code needed.
- Upload term files for whitelist/blacklist pipes inline (hits the existing parse endpoints).
- Validate the config before saving (`POST /pipelines/{id}/validate`).
- Save as a named pipeline with description. Updates create new immutable versions; the UI shows version history and config diffs.

**Depends on:** Pipeline CRUD API (exists), pipe-types endpoint (exists), JSON Schema with UI hints (exists).

## Inference playground

A paste-and-try interface for running pipelines on ad-hoc text.

**What it does:**
- Pick a saved pipeline from a dropdown (populated from `GET /pipelines`).
- Paste or type clinical text into an input area.
- Submit and see results side-by-side: original text on the left, redacted text on the right, with detected spans highlighted and colour-coded by label.
- Span table below showing start, end, label, confidence, and source for each detection.
- Toggle intermediary trace view to inspect the document state after each pipeline step (when the pipeline config has `store_intermediary` enabled).
- Processing time displayed for latency awareness.
- Batch mode: upload a text file or JSONL and process all documents, download results as JSONL.

**Depends on:** Process endpoints (exist), intermediary tracing (exists).

## Audit log viewer

A dashboard for reviewing and searching inference history.

**What it does:**
- Paginated log table with filters: pipeline name, date range, request ID, label presence, processing time threshold.
- Log detail view showing full request/response: original text, redacted text, all spans, pipeline version, timing.
- Span diff viewer: highlight what changed between original and redacted text with inline annotations.
- Dashboard charts: requests over time, label frequency distribution, average processing time trends.
- Export filtered logs as CSV or JSONL.

**Depends on:** Persistent audit log tables and query API (planned — `AuditLogRecord`, `GET /audit/logs`). Today, responses carry all auditable fields but are not persisted server-side.

## Dataset workshop

A UI for the full dataset preparation workflow: synthesise, ingest, transform, compose, and inspect.

### Synthesis

- Configure LLM synthesis parameters: model, PHI types, few-shot examples, special rules.
- Generate notes one at a time with preview (clinical text + highlighted spans).
- Batch generate N notes, preview a sample, and save to a corpus (JSONL or BRAT).
- Monitor generation progress and token usage.

**Depends on:** Synthesis library (exists). Would need a thin API layer to expose `LLMSynthesizer.generate_one()` over HTTP.

### Ingestion

- Upload raw dataset files (PhysioNet id.text + ann.csv, ASQ-PHI .txt, MIMIC NOTEEVENTS.csv, SREDH .txt files) via drag-and-drop.
- Select the dataset format and configure options (label maps, split ratios, merge-adjacent for MIMIC).
- Preview parsed documents before committing to disk.
- Trigger processing and see progress (document count, label distribution as it builds).

**Depends on:** Ingest library and scripts (exist). Would need upload + job-tracking API endpoints.

### Transforms

- Load an existing corpus (from server path or upload).
- Build a transform pipeline visually: label filter, label remap, resample, boost by label, re-split.
- Preview the effect of each step (before/after label distribution, document count).
- Save the transformed corpus to a new location.

**Depends on:** Transform library (exists). Would need a transform job API.

### Composition

- Select multiple source corpora (by server path or upload).
- Choose a composition strategy (merge, interleave, proportional) and configure weights.
- Toggle ID namespacing and provenance tracking.
- Preview the composed corpus (document count per source, label distribution).
- Save the result.

**Depends on:** Composition library (exists). Would need a composition job API.

### Analytics

- Select any corpus and view: document count, label distribution bar chart, span length histogram, spans-per-document histogram, overlap statistics, label co-occurrence heatmap.
- Compare two corpora side-by-side (e.g. before and after transforms).
- Drill down: click a label to list all spans of that type, click a document to see its full text with annotations.

**Depends on:** Analytics library (exists), list-spans-by-label (exists). Would need analytics API endpoints.

## Evaluation

A UI for measuring pipeline quality against gold-standard annotated data.

**What it does:**
- Select a pipeline and a gold corpus (server path, saved dataset ID, or drag-and-drop upload of JSONL / zipped BRAT).
- Run evaluation and display: micro precision, recall, F1 (strict exact match).
- Per-label breakdown table with sortable columns.
- Worst-performing documents list — click to see the document with gold spans vs predicted spans side-by-side.
- Confusion matrix: which labels get misclassified as which.
- Compare two evaluation runs (e.g. pipeline v1 vs v2) with delta columns and statistical significance.
- Save evaluation runs for historical tracking.

**Planned evaluation modes:**
- Strict (exact start, end, label match) — implemented today as library code.
- Exact boundary (start and end match, label ignored).
- Partial overlap (any character overlap counts as partial match).
- Token-level (whitespace-tokenised comparison).
- Risk-weighted recall (per-label weights reflecting HIPAA severity).

**Depends on:** Evaluation library (strict_micro_f1 exists). Would need: evaluation API (`POST /eval/run`, `GET /eval/runs`), persistent `EvalRunRecord` table, upload endpoint for gold corpora.

## Tech stack

The planned UI uses:
- **htmx** — AJAX without JavaScript; server returns HTML fragments.
- **Jinja2** — Server-side templates, already a FastAPI dependency.
- **Chart.js** — Client-side charts for dashboards and analytics.
- **No build step** — Static CSS/JS served directly. No React, no bundler, no node_modules.

This keeps the UI lightweight and deployable anywhere the API runs, with no separate frontend build or hosting.

## Implementation order

| Priority | Component | Why |
|----------|-----------|-----|
| 1 | Inference playground | Highest immediate value; depends only on existing endpoints |
| 2 | Pipeline authoring | Natural companion to playground; depends on existing endpoints |
| 3 | Evaluation UI | Requires eval API (planned phase 3-4) |
| 4 | Audit log viewer | Requires persistent audit tables (planned phase 2-3) |
| 5 | Dataset workshop | Requires several new API endpoints; CLI scripts cover this workflow today |

The inference playground and pipeline authoring can be built against the current API with no backend changes. The remaining components require planned API extensions documented in [DESIGN_PLAN.md](../DESIGN_PLAN.md).
