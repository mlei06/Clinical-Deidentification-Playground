# Playground UI

The Playground UI is a React + TypeScript single-page application (Vite, Tailwind CSS, TanStack Query) that wraps every major workflow. All UI features call the same Python library code and HTTP endpoints that the CLI uses — no duplicate logic.

## Running

```bash
cd frontend
npm install
npm run dev          # dev server on localhost:5173
```

The frontend expects the API at `localhost:8000`. Start it with `clinical-deid serve`.

## Views

### Pipeline Builder (`/create`)

Visual editor for composing and versioning de-identification pipelines.

- Browse the pipe catalog with install status, descriptions, and role tags (detector, span transformer, redactor).
- Drag pipes into a sequential layout with a merge strategy selector for span resolution.
- Each pipe renders a dynamic config form generated from its JSON Schema + `ui_*` hints — no per-pipe frontend code needed.
- Upload term files for whitelist/blacklist pipes inline.
- Validate the config before saving.
- Save as a named pipeline with description.

**API endpoints used:** `GET /pipelines/pipe-types`, `POST /pipelines`, `PUT /pipelines/{name}`, `POST /pipelines/{name}/validate`, `POST /pipelines/whitelist/parse-lists`, `POST /pipelines/blacklist/parse-wordlists`.

### Inference (`/inference`)

Paste-and-try interface for running pipelines on ad-hoc text.

- Pick a saved pipeline from a dropdown.
- Paste or type clinical text into an input area.
- Submit and see results: original text with detected spans highlighted and colour-coded by label, redacted text, and a span table with start, end, label, confidence, and source.
- Toggle intermediary trace view to inspect the document state after each pipeline step.
- Processing time displayed for latency awareness.

**API endpoints used:** `GET /pipelines`, `POST /process/{pipeline_name}`.

### Evaluate (`/evaluate`)

Dashboard for measuring pipeline quality against gold-standard annotated data.

- Select a pipeline and a gold corpus (registered dataset name or file path).
- Run evaluation and view: precision, recall, F1 across all matching modes (strict, partial, token-level, exact boundary).
- Per-label breakdown table with sortable columns.
- Confusion matrix showing label misclassification patterns.
- Compare two evaluation runs with delta columns.
- Risk-weighted recall and HIPAA coverage report.
- Worst-performing documents list.

**API endpoints used:** `POST /eval/run`, `GET /eval/runs`, `GET /eval/runs/{id}`, `POST /eval/compare`.

### Datasets (`/datasets`)

Full dataset lifecycle management.

- **Register** datasets from local paths (JSONL, BRAT directory, BRAT corpus).
- **Browse** registered datasets with document count, span count, and label distribution.
- **Preview** documents with text snippets and span summaries.
- **Compose** multiple datasets (merge, interleave, proportional sampling).
- **Transform** datasets (drop/keep labels, label mapping, resize, boost rare labels, re-split).
- **Generate** synthetic clinical notes via LLM.
- **Analytics** — label distribution, span statistics, cached and refreshable.

**API endpoints used:** `GET/POST /datasets`, `GET /datasets/{name}`, `POST /datasets/compose`, `POST /datasets/transform`, `POST /datasets/generate`, `GET /datasets/{name}/preview`.

### Dictionaries (`/dictionaries`)

Upload and manage whitelist and blacklist term lists.

- List all dictionaries filtered by kind and label.
- Upload new term files (txt, csv, json).
- Preview terms and metadata.
- Delete dictionaries.

Dictionaries are referenced by name in whitelist/blacklist pipe configs.

**API endpoints used:** `GET /dictionaries`, `POST /dictionaries`, `DELETE /dictionaries/{kind}/{name}`.

### Deploy (`/deploy`)

Configure which pipelines are available in production.

- **Inference modes** — map named modes (e.g. "fast", "balanced") to saved pipelines. Clients request a mode name and the production API routes to the configured pipeline.
- **Default mode** — set which mode is used when no mode is specified.
- **Pipeline allowlist** — when enabled, only checked pipelines can be used in production. Unchecked pipelines return 403.
- **Production API URL** — set the remote production server's base URL to enable production audit log viewing from the Audit tab.

Configuration is stored in `modes.json` at the project root.

**API endpoints used:** `GET /deploy`, `PUT /deploy`, `GET /deploy/pipelines`.

### Audit (`/audit`)

Browse and monitor the audit trail.

- **Stats dashboard** — total requests, average duration, total spans detected, source breakdown.
- **Top pipelines** bar chart.
- **Log table** — paginated, filterable by pipeline name and source (api/cli/production-api).
- **Detail panel** — click a row to see full metadata: pipeline config, metrics, timing, dataset source.
- **Local/Production toggle** — when a production API URL is configured (in Deploy), switch between viewing local and remote production audit logs.

**API endpoints used:** `GET /audit/logs`, `GET /audit/logs/{id}`, `GET /audit/stats`, `GET /audit/production/logs`, `GET /audit/production/stats`.

## Tech stack

- **React 19** with TypeScript
- **Vite** for build and dev server
- **Tailwind CSS** for styling
- **TanStack Query** (React Query) for data fetching and cache management
- **Lucide React** for icons
- **clsx** for conditional class names

## Frontend structure

```
frontend/src/
  api/              # API client functions (typed fetch wrappers)
    client.ts       # Base fetch with error handling
    pipelines.ts    # Pipeline CRUD
    datasets.ts     # Dataset CRUD + compose/transform/generate
    audit.ts        # Audit log queries (local + production)
    deploy.ts       # Deploy config
    types.ts        # Shared TypeScript types
  components/
    create/         # Pipeline builder (canvas, pipe cards, config forms)
    inference/      # Text input, span highlighting, trace viewer
    evaluate/       # Eval dashboard, metrics tables, confusion matrix
    datasets/       # Register, list, detail, compose, transform, generate forms
    dictionaries/   # Upload, browse, manage term lists
    deploy/         # Mode editor, allowlist, production URL
    audit/          # Log table, stats cards, detail panel
    layout/         # Shell (sidebar nav, content area)
    shared/         # Reusable components (SpanHighlighter, LabelBadge, etc.)
  hooks/            # TanStack Query hooks (useDatasets, useAudit, useDeploy, etc.)
  App.tsx           # Routes
```
