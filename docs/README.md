# Documentation index

| Document | Contents |
|----------|----------|
| [../README.md](../README.md) | Repo quick start, CLI, layout, API table |
| [configuration.md](configuration.md) | Environment variables, auth scopes, CORS, body limits, `.env` resolution |
| [api.md](api.md) | HTTP API reference (paths, auth notes) |
| [deployment.md](deployment.md) | Single-API production layout, Docker, volumes, security |
| [docker-quickstart.md](docker-quickstart.md) | Build, env vars, volume mounts, and pointing a frontend at the API |
| [staging-smoke.md](staging-smoke.md) | Post-deploy manual checks |
| [pipes-and-pipelines.md](pipes-and-pipelines.md) | Pipe types, composition, registry |
| [models.md](models.md) | Filesystem model registry (`models/{framework}/{name}/`) |
| [evaluation.md](evaluation.md) | Metrics, matching modes, eval API |
| [data-ingestion.md](data-ingestion.md) | Dataset formats, registration, transforms |
| [ui.md](ui.md) | Playground UI views |
| [synthesis.md](synthesis.md) | LLM note synthesis |
| [neuroner-setup.md](neuroner-setup.md) | NeuroNER Docker sidecar |
| [transforms-and-composition.md](transforms-and-composition.md) | Dataset transforms |
| [training-core-design.md](training-core-design.md) | Training package design notes (`clinical-deid train`, `src/clinical_deid/training/`) |

**Project narrative:** [../PROJECT_OVERVIEW.md](../PROJECT_OVERVIEW.md) (architecture and pipe system).

Historical design proposals and one-off API plans have been removed from the repo; behavior is authoritative in code and the docs above.
