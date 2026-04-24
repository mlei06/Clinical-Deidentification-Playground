# Implementation plan: Playground JSONL upload + remote API deployment

## Purpose

This plan ships two related flows that both end in a **normal registered dataset** (same `corpora/{name}/corpus.jsonl` + analytics as path-based import):

1. **Playground — upload a file** — Users pick a local **`.jsonl`** in the Datasets tab (no server path). Same backend as today for **eval / transform / compose / export / doc edit**.
2. **Production UI — push to server (no “export then re-upload” hop)** — After reviewers finish in [`DatasetExportBar`](../../frontend-production/src/components/production/DatasetExportBar.tsx), they can **register the generated JSONL on the API** in one step instead of: download → switch app → upload/register manually.

The **API** is expected to run on a **separate** host from both SPAs; both frontends use **`VITE_API_BASE_URL`** (and an **admin** key where required). The plan also points at **residual backlog** from [dataset-creation-implementation.md](dataset-creation-implementation.md) (optional; not blockers for upload).

---

## Deployment model (assumed)

| Piece | Role |
|-------|------|
| **API** | `clinical-deid-api` on a host:port (or behind a reverse proxy). Persists `data/corpora/`, `data/pipelines/`, etc. on a volume. |
| **Playground UI** | Static or dev server; **`VITE_API_BASE_URL`** points at the API origin (e.g. `https://deid-api.example.com` or `http://10.0.0.5:8000`). |
| **Auth** | Dataset routes are **admin**-scoped. Users set **`VITE_API_KEY`** to an **admin** API key for register/upload/transform/eval, or open APIs only in local dev. |

**Already supported:** CORS via `CLINICAL_DEID_CORS_ORIGINS` (include the Playground origin). **Body size** via `CLINICAL_DEID_MAX_BODY_BYTES` (default 10 MiB — may need raising for large JSONL; document trade-offs). See [docs/configuration.md](../configuration.md) and [docs/deployment.md](../deployment.md).

**Not in v1 of this plan:** running the Playground and API in one process; the plan targets **separate** instances and env-based API URL (existing Vite pattern).

---

## User story

1. User opens **Datasets** in the Playground (browser → static UI, talking to **remote** API).
2. User chooses **“Upload JSONL”** (or equivalent), picks a file, enters a **dataset name** (and optional description).
3. UI sends a **single multipart** request to the API.
4. API writes the file under **`CLINICAL_DEID_CORPORA_DIR / {name} / corpus.jsonl`**, runs the same **analytics + manifest** path as `dataset_store.import_jsonl_dataset` (or a thin wrapper), returns **DatasetDetail**.
5. Dataset appears in the list; user runs **POST /eval/run** with `dataset_name`, **transforms**, **compose**, etc., unchanged.

**Constraints (product):**

- **Format:** one `AnnotatedDocument` per line, same as existing JSONL contract (see [data-ingestion.md](../data-ingestion.md)).
- **Name:** same validation as `RegisterDatasetRequest` / `_validate_name` (safe identifier; no `..`).
- **Size:** must respect `CLINICAL_DEID_MAX_BODY_BYTES` (and optionally a dedicated cap for uploads in v2).

**Out of scope for v1:** multipart BRAT tree upload, resumable/chunked uploads, virus scanning, non-admin upload endpoints.

### Progress

| Item | Status |
|------|--------|
| `GET /health` + `api_key_scope` (admin vs inference) for SPAs | **Shipped** — [docs/api.md](../api.md#health) |
| `POST /datasets/upload` + `line_format=annotated_jsonl \| production_v1` + [`production_export_jsonl.py`](../../src/clinical_deid/ingest/production_export_jsonl.py) | **Shipped** — [`upload.py`](../../src/clinical_deid/api/routers/datasets/upload.py) |
| Playground **Upload JSONL** + `apiFetch` FormData handling | **Shipped** — [`UploadJsonlForm`](../../frontend/src/components/datasets/UploadJsonlForm.tsx), [`api/datasets.ts` `uploadDataset`](../../frontend/src/api/datasets.ts) |
| Production **Register on server** (modal + `production_v1` upload) | **Shipped** — [`DatasetExportBar`](../../frontend-production/src/components/production/DatasetExportBar.tsx), [`api/datasets.ts`](../../frontend-production/src/api/datasets.ts) |

---

## Code map, guardrails, and dependencies (code review)

This section ties the plan to **current** modules so implementers do not guess paths or miss edge cases.

### Backend: register and import invariants

| Concern | Where | Notes |
|--------|--------|--------|
| API surface | [`list_and_import.py`](../../src/clinical_deid/api/routers/datasets/list_and_import.py) | `_register_jsonl` → `import_jsonl_dataset` for `POST /datasets` and `POST /datasets/import/jsonl`. New **`POST /datasets/upload`** should call the same import path after the body is a valid on-disk file. |
| Core import | [`dataset_store.py`](../../src/clinical_deid/dataset_store.py) — `import_jsonl_dataset` | Takes **`data_path` to an existing file**, `shutil.copy2` to `{corpora_dir}/{name}/corpus.jsonl` (`CORPUS_JSONL_NAME`), then `_load_documents` / manifest. **Rmtree the new home on any error** (already inside `import_jsonl_dataset`). Upload handler must **write uploaded bytes to a temp file** on the same filesystem as `CLINICAL_DEID_CORPORA_DIR` (or any path `Path(...).is_file()` can read), then call `import_jsonl_dataset` — there is no “bytes API” today. |
| Name validation | [`dataset_store.py`](../../src/clinical_deid/dataset_store.py) — `_validate_name` | Regex `^[a-zA-Z0-9][a-zA-Z0-9._-]*$` and `..` rejected; 409/422 behavior already mirrored in [`_register_jsonl`](../../src/clinical_deid/api/routers/datasets/list_and_import.py). |
| Line contract | [`ingest/jsonl.py`](../../src/clinical_deid/ingest/jsonl.py) | Each non-empty line → Pydantic [`AnnotatedDocument`](../../src/clinical_deid/domain.py) (`document.id/text/metadata`, `spans` with bounds checked vs text length). |
| Router auth | [`datasets/__init__.py`](../../src/clinical_deid/api/routers/datasets/__init__.py) | Single `APIRouter` with `dependencies=[require_admin]` — **all** dataset routes, including a new upload route, are admin-scoped. |
| **Route registration order** | [`datasets/__init__.py`](../../src/clinical_deid/api/routers/datasets/__init__.py) | Literal paths (`/import/...`, `/preview-labels`, etc.) are imported **before** `by_name`. Add **`upload` (or `list_and_import` sibling) import before `by_name`** so `/datasets/upload` is not captured by `/{name}`. |
| Fixtures / tests | [`tests/test_datasets_api.py`](../../tests/test_datasets_api.py) | `_write_sample_jsonl` shows the JSON shape the loader accepts; extend with multipart `TestClient` tests for the new route. |

### HTTP: body size and limits

| Concern | Where | Notes |
|--------|--------|--------|
| Global cap | [`MaxBodySizeMiddleware`](../../src/clinical_deid/api/middleware.py) + `CLINICAL_DEID_MAX_BODY_BYTES` in [`config.py`](../../src/clinical_deid/config.py) | Rejects when **`Content-Length` > max**; returns **413** with `{"detail": "...-byte limit"}`. |
| **Chunked / missing Content-Length** | Same middleware | Documented: requests **without** `Content-Length` are **not** rejected by the middleware; do not rely on the middleware alone for hard limits on exotic clients. Prefer documenting normal browser multipart (sends `Content-Length`). |
| CORS | [`app.py`](../../src/clinical_deid/api/app.py) + settings | `allow_headers: ["*"]` — preflight for `X-API-Key` and multipart is fine; still list Playground/Production origins in `CLINICAL_DEID_CORS_ORIGINS` for deploys. |

### Playground UI and API client

| Concern | Where | Notes |
|--------|--------|--------|
| Path-based register | [`RegisterForm.tsx`](../../frontend/src/components/datasets/RegisterForm.tsx), [`DatasetsView.tsx`](../../frontend/src/components/datasets/DatasetsView.tsx) | `useRegisterDataset` + JSON `POST /datasets` with `data_path` on the server. |
| Register API | [`api/datasets.ts`](../../frontend/src/api/datasets.ts) | `registerDataset` uses `apiFetch` + JSON body. |
| **Multipart pattern (do not use raw `apiFetch` for `FormData`)** | [`api/client.ts`](../../frontend/src/api/client.ts) | `apiFetch` always merges **`Content-Type: application/json`**, which breaks **`multipart/form-data`** boundary. **Existing fix in-repo:** [`uploadDictionary`](../../frontend/src/api/dictionaries.ts) uses `fetch` + `apiBaseUrl` + `authHeaders()` only (no default JSON content-type). Reuse that pattern for `uploadDataset` (or extend `apiFetch` to skip JSON `Content-Type` when `init.body` is `FormData`). |
| React Query | [`useDatasets.ts`](../../frontend/src/hooks/useDatasets.ts) | `useRegisterDataset` mutation; add `useUploadDataset` + invalidate `['datasets']` on success. |

### Production UI

| Concern | Where | Notes |
|--------|--------|--------|
| Export line shape | [`DatasetExportBar.tsx`](../../frontend-production/src/components/production/DatasetExportBar.tsx) | `JsonlLine` (e.g. `schema_version`, `output_type`, `text`, `spans`, `resolved`, `metadata`) — **not** `AnnotatedDocument` lines. |
| API client | [`frontend-production/.../client.ts`](../../frontend-production/src/api/client.ts) | Same `apiFetch` + forced JSON `Content-Type` as Playground; multipart must mirror `fetch` + `authHeaders()`. |
| Admin vs inference | [`getHealth`](../../frontend-production/src/api/health.ts) + `/health` | Button enablement uses `api_key_scope === 'admin'`; server-side `POST /datasets/*` must still **enforce** `require_admin` (never trust the client). |

### Design / docs cross-links

- [`docs/design/production-ui-assisted-ner-datasets.md`](../design/production-ui-assisted-ner-datasets.md) — cross-link when **Register on server** is fully wired.
- [`docs/data-ingestion.md`](../data-ingestion.md) — JSONL / `AnnotatedDocument` contract.
- [`docs/api.md`](../api.md) — add `POST /datasets/upload` and multipart fields when implemented.

### Risks to track in implementation (not blockers, but do not be surprised)

1. **Temp disk space:** Large uploads = temp file + copy into `corpora_dir` (two writes); acceptable for v1; optional later: stream to final path to avoid double disk use.
2. **Production zip exports:** `asZip` wraps `corpus.jsonl` + `manifest.json`. If `line_format=production_v1` only accepts line-delimited JSON, **either** require flat `.jsonl` upload only **or** add an optional “extract `corpus.jsonl` from zip” path — the plan’s default of raw JSONL matches current export when **zip is off**.
3. **Async `buildLine`:** redacted / surrogate paths call [`redactDocument`](../../frontend-production/src/api/production.ts); server-side converter for `production_v1` only needs the **exported** line shape, not to re-run inference.

---

## Use case B — Production export → same backend (avoid download/swap)

### Current friction

1. In **Production UI**, user exports **JSONL** (or zip) via `DatasetExportBar` (lines built in `buildLine` — custom `JsonlLine` shape: `schema_version`, `output_type`, `text`, `spans`, `resolved`, `metadata`, etc.).
2. They must **save the file**, open **Playground** Datasets, and **upload** (use case 1) or place the file on the server and use path register — a context switch and extra steps.

### Blocker: line schema ≠ `AnnotatedDocument`

`POST /datasets` / `import_jsonl_dataset` expect each line to validate as Pydantic **`AnnotatedDocument`** (`{ "document": { "id", "text", "metadata" }, "spans": [...] }`) — see [`ingest/jsonl.py`](../../src/clinical_deid/ingest/jsonl.py). Production’s export is **not** that shape, so a **raw** upload of a Production file **will fail** unless we convert.

### Recommended approach (single source of truth on the server)

- **Add a converter** in Python, e.g. `ingest/production_export_jsonl.py` — `def production_line_to_annotated_document(obj: dict) -> AnnotatedDocument` (or validate `schema_version == 1` and map fields). Cover `annotated`, `redacted`, and `surrogate_annotated` as needed.
- Extend **`POST /datasets/upload`** (or a sibling `POST /datasets/upload-from-production`) with a field or query flag **`line_format=annotated_jsonl | production_v1`**. When `production_v1`, parse each line as JSON, convert, re-serialize to a temp `AnnotatedDocument` JSONL, then run existing `import_jsonl_dataset` (or feed converted docs to the same manifest path).
- **Tests:** golden fixture: one Production export line in → one `AnnotatedDocument` out; round-trip `model_dump_json` line matches loader expectations.

**Alternative (not preferred):** Convert in **`frontend-production`** to `AnnotatedDocument` lines before upload — faster to wire but **duplicated** rules vs Python and can drift from server validation.

### Production UI (Phase 4)

- Reuse the **same in-memory** `jsonl` string that `handleExport` already builds (or rebuild from the same `buildLine` loop — avoid drift).
- Add a secondary action: **“Register on server”** (or “Send to Datasets API”) next to **Download**:
  - **Modal:** dataset **name** (server-safe identifier), **description**; call **`POST /datasets/upload`** with `FormData`: `file` = `Blob` from the JSONL string, `line_format=production_v1` (if using the flag), plus optional metadata (e.g. `exported_at` in dataset description).
- **Auth:** same **`VITE_API_KEY`** as other production API calls, but this route is **admin**-scoped. Document that operators must set an **admin** key in Production **only in trusted environments**; for locked-down production reviewer stations, this button can stay disabled or use a **separate** backend proxy that holds the key (out of v1).
- **Extend [`api/client.ts`](../../frontend-production/src/api/client.ts)** (or a small `adminUpload` helper) so **`FormData` requests do not set `Content-Type: application/json`** (same issue as Playground `apiFetch`).

**Exit:** Reviewer can go from “export ready” to “dataset visible in `GET /datasets`” without downloading and switching to Playground, **when** admin credentials are available to the app.

---

## Phase 0 — Prerequisites and doc touchpoints

- [ ] Confirm **CORS** includes the Playground’s deployed origin; confirm **max body** for expected JSONL sizes (raise cap or add streaming in a later phase).
- [ ] Add a short “Remote API + Playground” note to [docs/deployment.md](../deployment.md) or [docs/docker-quickstart.md](../docker-quickstart.md) if not already obvious: `VITE_API_BASE_URL`, `VITE_API_KEY`, CORS, TLS at proxy.
- [ ] Link this plan from [docs/README.md](../README.md).

**Exit:** Operators can run UI and API on different hosts; dataset upload is the only *new* feature in later phases.

---

## Phase 1 — Backend: accept uploaded JSONL and register

**Prerequisite:** Read [**Code map, guardrails, and dependencies**](#code-map-guardrails-and-dependencies-code-review) — `import_jsonl_dataset` only accepts a **server file path**; temp file + `require_admin` + router order are non-negotiable.

**Option A (recommended):** New route **`POST /datasets/upload`** (admin-only, same as other dataset mutators):

- `multipart/form-data` fields: **`file`** (required, `.jsonl` or `application/json` / `text/plain` as needed), **`name`**, optional **`description`**, optional **`metadata`** (JSON string if you want flexibility), optional **`line_format`** (e.g. `annotated_jsonl` default, `production_v1` for use case B — see [Use case B](#use-case-b--production-export--same-backend-avoid-downloadswap)).
- Handler:
  1. Validate `name` with existing rules; reject if dataset home already exists.
  2. If `line_format=production_v1` (or equivalent): read uploaded bytes, **convert** each line to `AnnotatedDocument` (see new ingest helper), write a **normalized** temp JSONL, then import that file; if default: treat file as `AnnotatedDocument` JSONL (current contract).
  3. Stream or buffer `file` to a **temp path** on the same filesystem as `corpora_dir` (e.g. `tempfile` next to corpora, or a staging dir under `corpora_dir` that is not a listed dataset), then call **`import_jsonl_dataset(corpora_dir, name, path_to_temp, ...)`**; **or** stream directly to `{corpora_dir}/{name}/corpus.jsonl` and reuse `_compute_summary` / `_build_manifest` to avoid a double full-file copy (optimize in one PR, but ship correctness first).
  4. On failure, remove partial `dataset_home` (same invariants as `import_jsonl_dataset`).
- Reuse `load_annotated_corpus` / analytics for the **final** on-disk `corpus.jsonl` — always **standard** `AnnotatedDocument` lines after conversion.

**Option B (alternative):** Extend **`POST /datasets`** with a multipart body variant when `file` is present. Prefer a **dedicated** `/upload` path so OpenAPI and the Playground client stay clear; document both if you must keep a single URL.

**Pydantic / OpenAPI:** Add `UploadFile` handling; return existing **`DatasetDetail`** (same as register).

**Tests** — extend existing [`tests/test_datasets_api.py`](../../tests/test_datasets_api.py) (helpers like `_write_sample_jsonl` already match `AnnotatedDocument` lines):

- Happy path: small JSONL fixture via `TestClient` multipart → `GET /datasets/{name}` shows expected `document_count` / `labels`.
- **`line_format=production_v1`:** minimal `JsonlLine`-shaped fixture (mirror export fields) → registered dataset passes `GET /datasets/{name}/preview` or label counts.
- Name conflict → 409.
- Invalid name → 422.
- Not a file / empty corpus → 422 with a clear error (reuse `import_jsonl_dataset` errors).
- Optional: file larger than one byte under limit but wrong format.

**Ruff + pytest** in the same PR as the route.

**Exit:** `curl` or pytest can create a dataset from an uploaded file with **no** pre-existing path on the client machine beyond the browser’s file.

---

## Phase 2 — Playground UI: Datasets tab

- [ ] New flow **“Upload JSONL”** in [`RegisterForm`](../../frontend/src/components/datasets/RegisterForm.tsx) or a sibling **UploadDatasetForm** card on [`DatasetsView`](../../frontend/src/components/datasets/DatasetsView.tsx):
  - `<input type="file" accept=".jsonl,application/x-ndjson,application/json" />` (tune for browsers).
  - Name + description fields; **Submit** calls new API helper.
- [ ] **`api/datasets.ts`:** `uploadDataset({ name, description?, file: File })` using `FormData`. **Do not use `apiFetch` as-is** — it always sets `Content-Type: application/json` ([`client.ts`](../../frontend/src/api/client.ts)). **Mirror** [`uploadDictionary`](../../frontend/src/api/dictionaries.ts) (`fetch` + `apiBaseUrl` + `authHeaders()`) or teach `apiFetch` to omit JSON `Content-Type` when `body` is `FormData`.
- [ ] On success: **invalidate** `['datasets']`, optionally `onRegistered(name)` to open detail.
- [ ] **Errors:** show API `detail` (FastAPI) for 413/400/422.

**Exit:** A user with **admin** key configured can register a dataset entirely from the browser against a **remote** API.

---

## Phase 2b (or 4) — Production UI: “Register on server”

- [x] **Gating (no upload yet):** `GET /health` → `api_key_scope`; **Register on server** enabled only for **`admin`** ([`DatasetExportBar`](../../frontend-production/src/components/production/DatasetExportBar.tsx)).
- [ ] **Depends on:** Phase 1 **upload** + **Production → `AnnotatedDocument` conversion** (`line_format=production_v1` or equivalent) and tests.
- [ ] `DatasetExportBar`: **modal** (dataset `name` / `description`); `FormData` with same `jsonl` string as download + **multipart client** (not raw [`apiFetch`](../../frontend-production/src/api/client.ts)); remove or replace placeholder click handler.
- [ ] [design/production-ui-assisted-ner-datasets.md](../design/production-ui-assisted-ner-datasets.md) — one paragraph cross-linking this flow when implemented.

**Can ship after** Playground upload (Phase 2) or **in parallel** if the backend already supports `line_format=production_v1` in the same upload handler.

---

## Phase 3 — Operator experience and limits

- [ ] **README / CLAUDE.md** — one paragraph: “To use upload against a remote API, set `VITE_API_BASE_URL` and an **admin** `VITE_API_KEY`; increase `CLINICAL_DEID_MAX_BODY_BYTES` if uploads fail with 413.”
- [ ] [docs/api.md](../api.md) — document `POST /datasets/upload` (or chosen path), multipart fields, and auth.
- [ ] If default **10 MiB** is too small for real corpora, either document recommended production value or add **`CLINICAL_DEID_MAX_UPLOAD_BYTES`** in a follow-up (optional).

**Exit:** No guesswork for deployers.

---

## Residual backlog (from earlier roadmap — optional, parallel)

Not required to ship **upload**; keep as separate issues or a slim “M8+” list:

| Item | Note |
|------|------|
| **Streaming / bounded-memory** `ingest-from-pipeline` | Today the API buffers all docs in a `list` before write — large raw-text ingests can OOM. |
| **`POST /datasets/{name}/documents/batch-patch`** | Deferred from [dataset-creation-implementation.md](dataset-creation-implementation.md). |
| **Production UI Vitest** for `DatasetExportBar` | No test files under `frontend-production` today. |
| **Symlink** / escape hardening for `source_path` | Extra test coverage. |
| **Drag-and-drop upload in Production UI** | [CLAUDE.md](../../CLAUDE.md) still notes production drag/drop; out of scope for this plan unless you expand. |

Update [dataset-creation-implementation.md](dataset-creation-implementation.md) intro to **“shipped + backlog”** when someone edits that file (separate commit).

---

## Suggested order

| Order | Deliverable |
|------|-------------|
| (done) | `GET /health` **`api_key_scope`** + Production register button gating (see [Progress](#progress)) |
| 1 | Phase 1 (API + tests, including **`line_format=production_v1`** path if done in the same PR) |
| 2 | Phase 2 (Playground UI + multipart client; optional `apiFetch` improvement shared with `dictionaries` pattern) |
| 3 | Phase 2b finish (modal + `FormData` + real handler; `frontend-production` `fetch` + `authHeaders`) |
| 4 | Phase 0 / 3 (docs, CORS/body size checklist) |
| 5 | Backlog table as separate tickets, not blocking |

---

## Definition of done (this plan)

- [ ] A user with **admin** API access can **upload a JSONL** from the **Playground** Datasets UI to a **remote** backend; the new dataset is listed and usable for **eval / transform / compose** without extra steps.
- [ ] **(Use case B)** A user with **admin** API access in **Production** can **register the export JSONL** on the same backend **without** downloading and re-uploading in Playground, using **server-side** Production line → **`AnnotatedDocument`** conversion (or an approved equivalent with tests).
- [ ] [docs/api.md](../api.md) and operator docs mention upload + CORS + body size + env vars (and `line_format` / production mapping when implemented); **route order**, **temp-file → `import_jsonl_dataset`**, and **multipart/413/chunking** caveats in [**Code map**](#code-map-guardrails-and-dependencies-code-review) are satisfied or explicitly updated if the design changes.
- [ ] No regression for existing **path-based** register (`POST /datasets` with `data_path` on server).

## Related

- [dataset-creation-implementation.md](dataset-creation-implementation.md) — original NER dataset pipeline roadmap (mostly implemented).
- [configuration.md](../configuration.md) — `CLINICAL_DEID_CORPORA_DIR`, `CLINICAL_DEID_MAX_BODY_BYTES`, CORS, auth.
- [eval-label-space-alignment-ui.md](eval-label-space-alignment-ui.md) — Evaluate tab label alignment (works with any registered dataset, including after upload).
