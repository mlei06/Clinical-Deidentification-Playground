# HTTP API Reference

The FastAPI application is defined in `src/clinical_deid/api/app.py`. Start the server with:

```bash
clinical-deid-api
# or: python -m clinical_deid
# or: uvicorn clinical_deid.api.app:app --reload --host 127.0.0.1 --port 8000
```

Default: `http://127.0.0.1:8000`. Interactive docs at `/docs` (Swagger UI) and `/redoc`.

## Security

The API has **no authentication or rate limiting**. It is intended for local or trusted-network use. See the [Configuration](configuration.md) guide for environment setup.

CORS is configured to allow `http://localhost:3000` and `http://127.0.0.1:3000` by default. Edit `src/clinical_deid/api/app.py` to widen origins for production.

## Endpoints

### Health

#### `GET /health`

Liveness check.

**Response:**
```json
{"status": "ok"}
```

---

### Pipelines

All pipeline routes are under `/pipelines`.

#### `GET /pipelines/pipe-types`

List all known pipe types, whether they are installed, and their JSON config schemas.

**Response:** `list[PipeTypeInfo]`

```json
[
  {
    "name": "regex_ner",
    "description": "Regex-based PHI detection",
    "role": "detector",
    "extra": null,
    "install_hint": "included",
    "installed": true,
    "config_schema": { ... }
  }
]
```

The `config_schema` includes `ui_*` annotations for dynamic form rendering.

#### `GET /pipelines/ner/builtins`

List built-in regex labels and bundled whitelist phrase-file labels.

**Response:**
```json
{
  "regex_labels": ["DATE", "PHONE", "EMAIL", "ID", "MRN", ...],
  "whitelist_labels": ["HOSPITAL", "PATIENT", ...]
}
```

#### `POST /pipelines/whitelist/parse-lists`

Parse uploaded text files into term lists for whitelist pipe configuration. Multipart form: `files` (list of uploaded files) + `labels` (list of corresponding label names).

**Request:** Multipart form data. Files must be UTF-8, max 2 MB each.

**Response:**
```json
{
  "results": [
    {"label": "HOSPITAL", "filename": "hospitals.txt", "terms": ["MGH", "BWH"], "count": 2}
  ]
}
```

#### `POST /pipelines/blacklist/parse-wordlists`

Merge multiple uploaded text files into one deduped term list for blacklist configuration.

**Request:** Multipart form data. Files must be UTF-8, max 2 MB each.

**Response:**
```json
{
  "terms": ["Dr", "Mr", "Mrs"],
  "count": 3,
  "source_files": ["common_titles.txt"]
}
```

#### `POST /pipelines`

Create a named pipeline.

**Request:**
```json
{
  "name": "my-pipeline",
  "description": "Regex + whitelist with overlap resolution",
  "config": {
    "pipes": [
      {"type": "regex_ner", "config": {}},
      {"type": "whitelist", "config": {}},
      {"type": "resolve_spans", "config": {"strategy": "longest_non_overlapping"}}
    ]
  }
}
```

**Response:** `201 Created` with full `PipelineDetail`.

**Errors:**
- `409` — Pipeline name already exists.
- `422` — Invalid pipeline config (pipe type not found, bad config values).

#### `GET /pipelines`

List all active pipelines.

**Response:** `list[PipelineSummary]`
```json
[
  {
    "id": "abc-123",
    "name": "my-pipeline",
    "description": "...",
    "latest_version": 1,
    "is_active": true,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  }
]
```

#### `GET /pipelines/{pipeline_id}`

Get pipeline details including current version config.

**Response:** `PipelineDetail` (extends `PipelineSummary` with `current_version`).

**Errors:** `404` — Pipeline not found or inactive.

#### `PUT /pipelines/{pipeline_id}`

Update a pipeline. Creates a new immutable version if the config changes (detected by SHA-256 hash of canonical JSON).

**Request:**
```json
{
  "description": "Updated description",
  "config": {
    "pipes": [...]
  }
}
```

Both fields are optional. If only `description` changes, no new version is created.

**Errors:** `404`, `422`

#### `DELETE /pipelines/{pipeline_id}`

Soft-delete a pipeline (sets `is_active = false`). The pipeline and its versions remain in the database for audit purposes.

**Response:** `204 No Content`

#### `POST /pipelines/{pipeline_id}/validate`

Validate a pipeline config without saving. Attempts to build the full pipe chain.

**Request:**
```json
{"config": {"pipes": [...]}}
```

**Response:**
```json
{"valid": true, "error": null}
```
or
```json
{"valid": false, "error": "Unknown pipe type: foo"}
```

---

### Process

#### `POST /process/{pipeline_id}`

Run a pipeline on a single text document.

**Request:**
```json
{
  "text": "Patient John Smith, DOB 03/15/1952, was seen at MGH.",
  "request_id": "optional-custom-id"
}
```

- `text` — max 500,000 characters.
- `request_id` — optional; auto-generated UUID if omitted.

**Response:**
```json
{
  "request_id": "abc-123",
  "original_text": "Patient John Smith, DOB 03/15/1952, was seen at MGH.",
  "redacted_text": "Patient [PATIENT], DOB [DATE], was seen at [HOSPITAL].",
  "spans": [
    {
      "start": 8,
      "end": 18,
      "label": "PATIENT",
      "text": "John Smith",
      "confidence": 0.95,
      "source": "regex_ner"
    }
  ],
  "pipeline_id": "pipe-id",
  "pipeline_name": "my-pipeline",
  "pipeline_version": 1,
  "processing_time_ms": 12.34,
  "intermediary_trace": null
}
```

If the pipeline includes a redactor pipe that transforms the text, `redacted_text` is the redactor's output. Otherwise, the API generates `[LABEL]` placeholder replacements from the detected spans.

**Errors:** `404` (pipeline not found), `500` (pipeline build failure)

#### `POST /process/{pipeline_id}/batch`

Process multiple documents in one request.

**Request:**
```json
{
  "items": [
    {"text": "Document one...", "request_id": "req-1"},
    {"text": "Document two..."}
  ]
}
```

- Max 100 items per batch.
- Each item follows the same text length limit (500K characters).

**Response:**
```json
{
  "results": [
    { ... ProcessResponse ... },
    { ... ProcessResponse ... }
  ],
  "total_processing_time_ms": 45.67
}
```

---

### Dictionaries

All dictionary routes are under `/dictionaries`. Dictionaries are term lists (whitelist or blacklist) stored under `data/dictionaries/`.

#### `GET /dictionaries`

List all stored dictionaries. Optional query params: `kind` (whitelist/blacklist), `label`.

#### `GET /dictionaries/{kind}/{name}`

Get a dictionary's terms. For whitelist dictionaries, pass `?label=HOSPITAL` to get a specific label section.

#### `GET /dictionaries/{kind}/{name}/preview`

Preview with sample terms and metadata.

#### `GET /dictionaries/{kind}/{name}/terms`

Paginated term list. Query params: `offset`, `limit`, `search`, `label`.

#### `POST /dictionaries`

Upload a dictionary file. Multipart form: `file` (txt/csv/json, max 2 MB), `kind`, `name`, optional `label`.

#### `DELETE /dictionaries/{kind}/{name}`

Delete a dictionary. Optional query param: `label`.

---

### Datasets

All dataset routes are under `/datasets`. Datasets are registered from local paths and stored as JSON manifests in `datasets/`.

#### `GET /datasets`

List registered datasets. Query params: `limit`, `offset`.

#### `POST /datasets`

Register a dataset from a local path. Validates data and computes analytics.

**Request:**
```json
{
  "name": "i2b2-2014",
  "data_path": "/path/to/corpus.jsonl",
  "format": "jsonl",
  "description": "i2b2 2014 de-identification corpus"
}
```

Supported formats: `jsonl`, `brat-dir`, `brat-corpus`.

**Errors:** `409` (name taken), `422` (invalid data), `404` (path not found).

#### `GET /datasets/{name}`

Full dataset metadata and cached analytics (label counts, span stats, etc.).

#### `PUT /datasets/{name}`

Update description or metadata (does not re-scan data).

#### `DELETE /datasets/{name}`

Unregister a dataset. Does **not** delete the underlying data files.

#### `POST /datasets/{name}/refresh`

Reload data from disk and recompute cached analytics.

#### `GET /datasets/{name}/preview`

Preview documents (paginated). Returns document ID, text preview, span count, and labels per document.

#### `GET /datasets/{name}/documents/{doc_id}`

Full document text with all spans.

#### `POST /datasets/compose`

Compose multiple datasets into a new registered dataset.

**Request:**
```json
{
  "output_name": "combined-corpus",
  "source_datasets": ["i2b2-2014", "physionet"],
  "strategy": "merge",
  "shuffle": true
}
```

Strategies: `merge` (concatenate), `interleave` (round-robin), `proportional` (weighted sampling with `weights`).

#### `POST /datasets/transform`

Apply transforms to a dataset and register the result. Available transforms (applied in order): drop/keep labels, label mapping, resize, boost rare labels, re-split, strip splits.

#### `POST /datasets/generate`

Generate synthetic clinical notes via LLM and register as a dataset.

**Request:**
```json
{
  "output_name": "synth-100",
  "count": 100,
  "phi_types": ["PERSON", "DATE", "LOCATION"],
  "description": "Synthetic training data"
}
```

---

### Evaluation

#### `POST /eval/run`

Run pipeline against a gold-standard dataset.

#### `GET /eval/runs`

List stored evaluation results.

#### `GET /eval/runs/{id}`

Evaluation result detail (metrics, per-label breakdown, document results).

#### `POST /eval/compare`

Compare two evaluation runs side-by-side.

---

### Audit

#### `GET /audit/logs`

Query audit trail. Query params: `pipeline_name`, `source`, `command`, `from_date`, `to_date`, `limit`, `offset`.

#### `GET /audit/logs/{id}`

Audit log detail (full pipeline config, metrics, etc.).

#### `GET /audit/stats`

Aggregate stats: total requests, average duration, top pipelines, source breakdown. Query params: `pipeline_name`, `source`.

#### `GET /audit/production/logs`

Proxy audit log listing from a remote production API. Requires `production_api_url` configured in `modes.json` (via the Deploy tab).

#### `GET /audit/production/logs/{id}`

Proxy a single audit log detail from the production API.

#### `GET /audit/production/stats`

Proxy audit stats from the production API.

---

### Deploy

Deploy configuration manages which pipelines are available in production and maps them to named inference modes.

#### `GET /deploy`

Read the current deploy configuration (modes, default mode, pipeline allowlist, production API URL).

#### `PUT /deploy`

Write an updated deploy configuration.

**Request:**
```json
{
  "modes": {
    "fast": {"pipeline": "regex-only", "description": "Fastest, regex only"},
    "balanced": {"pipeline": "balanced-v2", "description": "Regex + Presidio"}
  },
  "default_mode": "balanced",
  "allowed_pipelines": ["regex-only", "balanced-v2"],
  "production_api_url": "https://prod-server:8000"
}
```

#### `GET /deploy/pipelines`

List all saved pipeline names (for populating UI dropdowns).

---

### Models

#### `GET /models`

List trained models from the `models/` directory.

#### `GET /models/{framework}/{name}`

Model manifest details.

#### `POST /models/refresh`

Re-scan the models directory.

---

## Request limits

| Limit | Value | Where defined |
|-------|-------|--------------|
| Text length | 500,000 characters | `schemas.py:MAX_TEXT_LENGTH` |
| Batch size | 100 items | `schemas.py:MAX_BATCH_SIZE` |
| Upload file size | 2 MB per file | `routers/pipelines.py:MAX_UPLOAD_BYTES` |

These constants can be adjusted by editing the source. Exceeding them returns `422` (validation error) or `413` (file too large).

## Database

Pipeline records and versions are stored in SQLite (default `./var/dev.sqlite`). The database is auto-created on first startup. Override the path with `CLINICAL_DEID_DATABASE_URL`.

Pipeline versions are **immutable** — updating a pipeline's config creates a new version rather than overwriting. Versions are deduplicated by content hash, so submitting the same config twice doesn't create a duplicate version.
