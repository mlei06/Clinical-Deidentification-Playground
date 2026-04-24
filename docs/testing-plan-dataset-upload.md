# Testing plan: dataset JSONL upload, Production register, and related API/UI

This document is a **QA and developer checklist** for the features delivered around **multipart dataset upload** (`POST /datasets/upload`), **Production UI “Register on server”** (`line_format=production_v1`), **`GET /health` `api_key_scope`**, **Playground “Upload JSONL”**, and **pytest noise control** for training (WordPiece deprecation filter). Use it for release validation, regression after refactors, and onboarding.

---

## 1. Scope (what we are validating)

| Feature | Backend | Playground | Production UI |
|--------|---------|------------|---------------|
| Register dataset from **browser file** (AnnotatedDocument JSONL) | `POST /datasets/upload` `line_format=annotated_jsonl` | Datasets → Ingestion → **Upload JSONL** | — |
| Register **Production export** lines on the API | Same route, `line_format=production_v1` | — | Export bar → **Register on server** (modal) |
| **Scope discovery** for admin vs inference keys | `GET /health` returns `api_key_scope` when `X-API-Key` sent | Optional: any code using health | `getHealth()` gates **Register on server** |
| **No regression** path-based register | `POST /datasets` with `data_path` | **Import JSONL (server path)** | — |
| **Eval / transform / compose** on newly registered names | Unchanged | After upload, use dataset name in flows | — |
| **Training tests** run without extra deprecation noise | `pyproject.toml` `filterwarnings` | — | — |

---

## 2. Prerequisites

- **Python 3.11+**, venv, editable install: `pip install -e ".[dev]"` (or `uv pip install -e ".[dev]"`).
- **Node.js** (LTS) for UIs: `npm install` in `frontend/` and `frontend-production/` as needed.
- **Data directory**: default `./data` (or set `CLINICAL_DEID_*` env vars). Run `clinical-deid setup` once if you use the full stack locally.
- Optional: two API keys in env for auth testing — one **admin**, one **inference** (see [configuration.md](configuration.md#authentication)).

---

## 3. How to run the API

From the repo root (venv active):

```bash
clinical-deid serve --port 8000 --reload
# equivalents:
# clinical-deid-api
# uvicorn clinical_deid.api.app:app --host 127.0.0.1 --port 8000 --reload
```

- **Default**: no API keys required (open mode) — suitable for most local manual tests.
- **Auth mode** (admin + inference keys): set `CLINICAL_DEID_ADMIN_API_KEYS` and `CLINICAL_DEID_INFERENCE_API_KEYS` (JSON arrays in env) per [configuration.md](configuration.md#authentication). Then:
  - **Dataset upload** and **path register** require **admin** key: `X-API-Key: <admin>` or `Authorization: Bearer <admin>`.
  - **`GET /health`**: unauthenticated; send the same `X-API-Key` as the UI to get `api_key_scope` (`admin` \| `inference` \| `null`).

**Body size**: large JSONL uploads may hit `CLINICAL_DEID_MAX_BODY_BYTES` (default 10 MiB) → **413**. For manual tests with big files, raise the cap in env and restart the API. See [configuration.md](configuration.md).

**CORS**: if the Playground or Production UI is **not** served from an origin the API allows, browser calls fail preflight. Set `CLINICAL_DEID_CORS_ORIGINS` to include the UI origin (e.g. `http://localhost:3000`).

---

## 4. How to run the Playground UI

```bash
cd frontend
npm install
npm run dev
```

- Default: **http://localhost:3000** (see `frontend/vite.config.ts`).
- Dev server **proxies** `/api` → `http://localhost:8000` with path rewrite (browser uses `/api/...` as the base; see `frontend` env).

**Point at a different API** (e.g. remote host): create `frontend/.env.local`:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
# or https://your-api.example.com
VITE_API_KEY=your-admin-key-when-auth-enabled
```

When `VITE_API_BASE_URL` is set, it replaces the default `/api` base — ensure CORS and TLS as needed.

**Where to test upload**: **Datasets** → **Ingestion** → **Upload JSONL** (and **Import JSONL (server path)** for regression).

---

## 5. How to run the Production UI

```bash
cd frontend-production
npm install
npm run dev
```

- Default: **http://localhost:3001** (see `frontend-production/vite.config.ts`). Same `/api` → `localhost:8000` proxy as Playground.

**Env** (`frontend-production/.env.local`):

```env
# Optional: same pattern as Playground
# VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_API_KEY=...
```

- Use an **inference** key for normal redaction / detection flows.
- **Register on server** is enabled only when `GET /health` reports `api_key_scope === "admin"` — for that, configure an **admin** key in `VITE_API_KEY` (or test in open API mode, where health reports admin scope for UIs).

**Where to test**: open a dataset with at least one file, use the export bar → **Register on server** (modal: dataset name, description).

---

## 6. Suggested process layout (local)

| Terminal / tab | Command |
|----------------|---------|
| 1 | `clinical-deid serve --port 8000 --reload` |
| 2 | `cd frontend && npm run dev` → :3000 |
| 3 (optional) | `cd frontend-production && npm run dev` → :3001 |

---

## 7. Automated tests (CI / pre-push)

### 7.1 Full suite (fast, no GPU)

```bash
pytest tests -q
```

### 7.2 Targeted: upload + production conversion

```bash
pytest tests/test_production_export_jsonl.py tests/test_datasets_api.py -k upload -q --tb=short
# optional: one-by-one
# pytest tests/test_datasets_api.py::test_upload_annotated_jsonl_multipart -q
```

### 7.3 Auth contract (unchanged behavior for new routes)

```bash
pytest tests/test_auth_contract.py -q
```

`POST /datasets/upload` is **admin-gated** like other `/datasets` mutators; the contract test enumerates mutating routes.

### 7.4 Health + `api_key_scope`

```bash
pytest tests/test_api.py tests/test_auth_contract.py -k health -q
```

### 7.5 Training extra (transformers, optional)

```bash
pip install -e ".[train]"
pytest tests/training/ -m train -q
```

Expect **no** WordPiece deprecation noise in the summary if `pyproject.toml` `filterwarnings` is in place.

### 7.6 Lint (Python)

```bash
ruff check src tests
ruff format --check src tests
```

### 7.7 Frontends (typecheck / build)

```bash
cd frontend && npm run build
cd ../frontend-production && npm run build
```

---

## 8. Manual test matrix

### 8.1 API: `GET /health` and scope

| Step | Action | Expected |
|------|--------|----------|
| H1 | `curl -s http://127.0.0.1:8000/health` (no key, open mode) | `200`, `api_key_scope` is `"admin"` (open deploy parity for UIs) |
| H2 | With auth on: no header | `api_key_scope` `null` |
| H3 | With auth on: `X-API-Key: <admin>` | `api_key_scope` `"admin"` |
| H4 | With auth on: `X-API-Key: <inference>` | `api_key_scope` `"inference"` |

### 8.2 API: `POST /datasets/upload` (AnnotatedDocument JSONL)

| Step | Action | Expected |
|------|--------|----------|
| U1 | Multipart: `name`, `file` (valid JSONL from [data-ingestion](data-ingestion.md)), `line_format=annotated_jsonl` | `201`, dataset appears in `GET /datasets` |
| U2 | Same `name` again | `409` |
| U3 | Invalid dataset name (e.g. `bad..x`) | `422` |
| U4 | Empty file | `422` |
| U5 | File over `CLINICAL_DEID_MAX_BODY_BYTES` (if you force size) | `413` |

**curl sketch** (from repo root, small file):

```bash
curl -s -X POST "http://127.0.0.1:8000/datasets/upload" \
  -F "name=my-upload-test" \
  -F "description=cli test" \
  -F "line_format=annotated_jsonl" \
  -F "file=@path/to/corpus.jsonl;type=application/x-ndjson"
```

With auth: add `-H "X-API-Key: $ADMIN_KEY"`.

### 8.3 API: `line_format=production_v1`

| Step | Action | Expected |
|------|--------|----------|
| P1 | Build one line matching Production export (`schema_version: 1`, `id`, `text`, `spans`, etc.) and POST as file | `201`, `document_count` ≥ 1 |
| P2 | Malformed line | `422` with clear `detail` |

### 8.4 Playground: Upload JSONL

| Step | Action | Expected |
|------|--------|----------|
| PG1 | Ingestion → **Upload JSONL**, pick a valid `AnnotatedDocument` JSONL, new name | Success toast path / dataset list refresh; open detail and see document count |
| PG2 | Wrong file type or invalid JSONL | Error message with API `detail` |
| PG3 | (Auth on) no key or non-admin key | `401`/`403` on upload; UI shows error |

### 8.5 Production UI: Register on server

| Step | Action | Expected |
|------|--------|----------|
| PR1 | **Inference** key only (auth on) | **Register** disabled; tooltip explains admin requirement |
| PR2 | **Admin** key (or open API) | Button enabled with files in scope |
| PR3 | Open modal, valid name, **Register** | Success summary; `GET /datasets` lists new name |
| PR4 | Duplicate name | Error in modal (409) |

### 8.6 Regression: path import + eval

| Step | Action | Expected |
|------|--------|----------|
| R1 | **Import JSONL (server path)** still works | Same as before upload feature |
| R2 | **Evaluate** using `dataset_name` for a dataset created via upload | Run completes; metrics as usual |

---

## 9. End-to-end smoke (remote API)

1. Run API on host A (or Docker per [deployment.md](deployment.md)).
2. Set `VITE_API_BASE_URL` to A and `VITE_API_KEY` (admin) in Playground `.env.local`.
3. CORS: include Playground origin on A.
4. Repeat **8.2** and **8.4** from the browser; confirm no mixed-content issues (HTTPS/HTTPS).

---

## 10. Rollback / triage

| Symptom | Check |
|--------|--------|
| 413 on upload | `CLINICAL_DEID_MAX_BODY_BYTES`, `Content-Length` (middleware) |
| CORS error in console | `CLINICAL_DEID_CORS_ORIGINS`, exact origin + scheme |
| Register disabled in Production | `GET /health` with current key; use admin key |
| 422 production_v1 | Line must match `src/clinical_deid/ingest/production_export_jsonl.py` (Production → `AnnotatedDocument`) |
| Multipart “boundary” error | Client must not set `Content-Type: application/json` on multipart (fixed in `apiFetch` for `FormData` in both frontends) |

---

## 11. References

- [docs/api.md](api.md) — `POST /datasets/upload`, `GET /health`
- [docs/configuration.md](configuration.md) — auth, CORS, body size
- [plans/playground-dataset-jsonl-upload.md](plans/playground-dataset-jsonl-upload.md) — design and code map
- [data-ingestion.md](data-ingestion.md) — JSONL / `AnnotatedDocument` contract

When this plan is stable, you can add a one-line link from CI or release notes; update the matrix if new routes or env vars are introduced.
