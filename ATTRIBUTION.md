# Attribution

## AI Development Tools

This project was developed with the assistance of AI coding tools. This document gives a substantive account of what was AI-assisted and what was human-designed, in accordance with course policy.

### Tools Used

| Tool | Usage |
|------|-------|
| **Claude (Anthropic)** — Claude Code CLI | Primary AI assistant throughout development |
| **GitHub Copilot** | Inline completions during editing |

---

## What Was Human-Designed

The following were conceived, specified, and architected by the developer before or independently of AI assistance:

- **Core platform concept**: local-first NER pipeline platform with swappable domain packs (not just a PHI de-identification tool)
- **Pluggable pack architecture**: the idea of LabelSpace / RiskProfile / RegexPatternPack / SurrogatePack as independently swappable bundles registered at startup
- **Pipe protocol design**: `Pipe.forward(AnnotatedDocument) -> AnnotatedDocument` as the single composition primitive; the `Detector` / `SpanTransformer` / `Redactor` / `Preprocessor` subtype hierarchy
- **Filesystem-first storage philosophy**: pipelines as JSON files, evaluations as JSON files, models as directories — SQLite only for the append-only audit trail
- **Two-frontend architecture**: `frontend/` (Playground for building/evaluating) vs. `frontend-production/` (Production NER workspace)
- **Evaluation design**: choosing to support four matching modes (strict, exact-boundary, partial, token-level) plus HIPAA-weighted risk recall alongside standard P/R/F1
- **Domain selection**: clinical PHI / HIPAA Safe Harbor as the default pack; generic_pii as a lightweight built-in alternative
- **Dataset lifecycle**: the full import → compose → transform → generate → export → evaluate loop as a first-class workflow

---

## What Was AI-Assisted

### Code Generation

AI tools assisted with implementation of well-specified components after architecture was decided:

- **Boilerplate and scaffolding**: FastAPI router stubs, Pydantic model definitions, pytest fixture setup, Vite/React component skeletons
- **Custom React widgets** (e.g., `UnifiedLabelField`, `WhitelistLabelField`, `LabelSpaceWidget`): AI helped implement complex UI components from written specs; logic and data flow were reviewed and adjusted manually
- **JSON Schema → UI Schema translation** (`schemaToUiSchema`): AI generated the recursive schema-walking logic from a written spec describing desired widget mappings
- **Evaluation metric implementations** (token-level BIO tagging, risk-weighted recall): AI translated mathematical specs into Python
- **SQL/SQLite layer** (`db.py`, `tables.py`): straightforward SQLModel boilerplate
- **CLI command wiring** (Click group/command structure): AI scaffolded the command tree from a written list of desired commands
- **BRAT ingest/export**: AI implemented the BRAT format reader/writer from the BRAT standoff annotation specification

### Debugging and Refactoring

- ESLint violation fixes (Rules of Hooks restructuring in `EvalLabelAlignment.tsx`, component hoisting in `PerLabelTable.tsx`, temporal dead zone fix in `LabelSpaceWidget.tsx`)
- Identifying and pruning dead code (empty `pydeid_ner/` directory, stale doc references, broken links in docs)
- Debugging `fieldPathId.path` propagation through `@rjsf/core` custom fields

### Documentation

- Docstring drafts (reviewed and edited by hand)
- This README, SETUP.md, and ATTRIBUTION.md were drafted with AI assistance and reviewed/edited by the developer

---

## What Was NOT AI-Generated

- **All architectural decisions** listed in the "Human-Designed" section above
- **All product decisions**: what views to build, what metrics matter, what the user experience should be
- **Data and model weights**: no model weights are included in the repository; training data sourced from public corpora (i2b2, PhysioNet, ASQ-PHI) under their respective licenses
- **Test case logic**: test scenarios and assertions were written to spec; AI helped translate specs into pytest syntax but did not invent the test cases

---

## Third-Party Libraries and Data

### Python

Key libraries (see `pyproject.toml` for full list):

| Library | License | Purpose |
|---------|---------|---------|
| FastAPI | MIT | HTTP API framework |
| Pydantic v2 | MIT | Config validation |
| SQLModel | MIT | SQLite ORM |
| spaCy | MIT | NLP tokenization |
| presidio-analyzer | MIT | NER via Microsoft Presidio |
| transformers (HuggingFace) | Apache 2.0 | Token-classification models |
| Click | BSD | CLI framework |
| ruff | MIT | Python linter |
| pytest | MIT | Test framework |

### Frontend (JavaScript)

| Library | License | Purpose |
|---------|---------|---------|
| React 19 | MIT | UI framework |
| Vite 8 | MIT | Build tool |
| Tailwind CSS v4 | MIT | Utility CSS |
| @xyflow/react | MIT | Pipeline canvas |
| @tanstack/react-query | MIT | Data fetching |
| zustand | MIT | Client state |
| @rjsf/core | Apache 2.0 | JSON Schema forms |
| recharts | MIT | Charts |
| lucide-react | ISC | Icons |

### Datasets (not included in repo)

| Dataset | Source | License |
|---------|--------|---------|
| i2b2 2014 De-identification | i2b2/n2c2 | DUA (research use) |
| PhysioNet MIMIC | physionet.org | PhysioNet DUA |
| ASQ-PHI | Public synthetic dataset | CC-BY |

---

## Course Context

This project was developed for **CS 372** at Duke University. The platform is a general-purpose NER pipeline framework; the clinical PHI de-identification use case serves as the reference configuration and primary demonstration domain.
