# Staging smoke checklist

Manual validation after deploying the single API (Docker or bare metal). Replace host, keys, and mode names as appropriate. See [deployment.md](deployment.md) for topology and auth.

## 1. Health

```bash
curl -sS http://localhost:8000/health
```

Expect JSON with healthy status.

## 2. Auth (when keys are configured)

Without a key, a mutating route should return `401`:

```bash
curl -sS -o /dev/null -w "%{http_code}" -X POST http://localhost:8000/pipelines \
  -H "Content-Type: application/json" -d "{}"
```

With an **inference** key, `GET /pipelines` should return `403`; `GET /deploy/health` should return `200`:

```bash
curl -sS http://localhost:8000/deploy/health -H "X-API-Key: $INFERENCE_KEY"
```

## 3. Inference

Ensure `modes.json` maps a mode (e.g. `fast`) to a pipeline that exists under `pipelines/`. If an allowlist is set, the pipeline must be listed.

```bash
curl -sS -X POST "http://localhost:8000/process/fast?output_mode=redacted" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $INFERENCE_KEY" \
  -d '{"text":"Patient John Doe visited on 01/02/2020."}'
```

Expect `200` and `spans` / `redacted_text` in the JSON.

## 4. Audit

```bash
curl -sS "http://localhost:8000/audit/logs?limit=5" -H "X-API-Key: $INFERENCE_KEY"
```

Confirm a recent row for the process call (hashed `client_id` when keys are used).

## 5. Docker Compose (optional)

From the repo root:

```bash
docker compose up --build -d
curl -sS http://localhost:8000/health
```

Ensure `modes.json` exists on the host or create it via the Playground with an **admin** key before relying on mode aliases.
