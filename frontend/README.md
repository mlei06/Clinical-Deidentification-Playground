# Clinical De-Identification Playground — Frontend

React + TypeScript single-page application for the Clinical De-Identification Playground.

## Setup

```bash
npm install
npm run dev          # default http://localhost:3000 (proxies /api → API)
npm run build        # production build to dist/
npm run lint         # ESLint
```

Requires the API server running at `localhost:8000`:

```bash
clinical-deid serve
```

## Views

| Route | Component | Purpose |
|-------|-----------|---------|
| `/create` | PipelineBuilder | Visual drag-and-drop pipeline composer |
| `/inference` | InferenceView | Paste text, see spans + redacted output + trace |
| `/evaluate` | EvaluateView | Run evals, view metrics/confusion/comparison |
| `/datasets` | DatasetsView | Register, browse, compose, transform, generate datasets |
| `/dictionaries` | DictionaryManager | Upload/manage whitelist & blacklist term lists |
| `/deploy` | DeployView | Configure production inference modes & pipeline allowlist |
| `/audit` | AuditView | Browse audit trail with stats, filters, local/production toggle |

## Tech stack

- React 19 + TypeScript
- Vite (build + dev server)
- Tailwind CSS
- TanStack Query (data fetching)
- Lucide React (icons)

See [docs/ui.md](../docs/ui.md) for detailed documentation of each view.
