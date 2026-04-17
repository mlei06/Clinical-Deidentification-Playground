# Implementation plan: detector-agnostic label-space API

## Goals

- One **generic** bundle URL and a single pattern for how the playground loads label space.
- **Catalog-driven** behavior so new detectors do not add routes—only registry/catalog metadata (and optional hooks).
- **Frontend** branches on **capabilities**, not hard-coded `pipeType === 'neuroner_ner'`.
- **Backward compatibility** for one release (deprecated paths or redirects).

---

## Phase 0: Inventory and contracts

**0.1** List all consumers of:

- `GET …/neuroner_ner/label-space-bundle`
- `GET …/presidio_ner/label-space-bundle`
- `POST …/pipe-types/{name}/labels`

**0.2** Freeze the **`LabelSpaceBundle`** JSON contract (already aligned): `labels_by_model`, `default_entity_map`, `default_model`; document semantic differences (NeuroNER: raw tags; Presidio: Presidio entity keys) in OpenAPI descriptions only.

**0.3** Decide deprecation policy: redirect (307) vs dual-register same handler—recommend **same handler, two route decorators** on one function for one release, then remove old paths.

---

## Phase 1: Registry and catalog metadata

**1.1** Add enum (or literal union) on the pipe catalog, e.g. `label_space: "none" | "compute" | "bundle" | "both"`:

- **`none`** — no label-space UI (or static schema only).
- **`compute`** — `POST /labels` only (regex_ner, many custom cases).
- **`bundle`** — `GET …/label-space-bundle` only (current NeuroNER/Presidio default UX).
- **`both`** — bundle for fast switching plus optional POST for edge overrides (document when POST is needed).

**1.2** Register values for existing detectors (at minimum: `neuroner_ner`, `presidio_ner`, and others that use `compute_base_labels` today).

**1.3** Optionally add `label_space_bundle_fn: str | None` (dotted import path) on `PipeCatalogEntry` **or** a single registry function `get_label_space_bundle(name) -> LabelSpaceBundle | None` that dispatches internally—pick one style and keep it consistent.

---

## Phase 2: Backend API consolidation

**2.1** Implement **generic** route: `GET /pipelines/pipe-types/{name}/label-space-bundle`

- Read catalog: if `label_space` is not `bundle` or `both` → **404** with clear `detail`, or **501** if preferred.
- Delegate to existing builders (neuroner, presidio) via registry dispatch—no per-pipe `if name ==` in the router beyond the dispatcher.

**2.2** Keep legacy routes as aliases (same response model) for compatibility:

- `GET …/neuroner_ner/label-space-bundle` → same handler as (2.1).
- Same for `presidio_ner`.

**2.3** `POST /pipelines/pipe-types/{name}/labels`

- Standardize response to **`{ "labels": string[] }`** in OpenAPI (NeuroNER-only fields removed from default response or gated behind `?debug=true`).
- Keep `compute_base_labels(name, config)` as the single implementation path.

**2.4** Extend **`GET /pipelines/pipe-types`** to include **`label_space`** (and optionally **`supports_label_space_bundle: bool`**) so the frontend can choose behavior without name checks.

---

## Phase 3: Frontend

**3.1** Extend **`PipeTypeInfo`** (or equivalent) with `label_space`.

**3.2** Refactor **`useLabelSpace`**:

- If `label_space` in `('bundle','both')` → fetch `GET /pipelines/pipe-types/${pipeType}/label-space-bundle` (generic path).
- If `('compute','both')` and bundle insufficient (optional) or pipe only `compute` → use `POST /labels` as today.
- Remove hard-coded `neuroner_ner` / `presidio_ner` branches; keep pipe-specific merge logic only where the data shape differs, behind a small strategy map keyed by `pipeType` **or** a catalog field like `label_bundle_key_semantics: "ner_raw" | "presidio_entity"`.

**3.3** Point bundle fetch helpers at the generic URL or delete thin wrappers after migration.

**3.4** Smoke-test pipeline builder: model switches, `entity_map` edits, loading states.

---

## Phase 4: Tests and docs

**4.1** API tests: generic bundle 200 for `neuroner_ner`/`presidio_ner`; 404 for a pipe with `label_space: "compute"` only; POST still works.

**4.2** Optional contract test: bundle JSON matches `LabelSpaceBundle` schema.

**4.3** Update **CLAUDE.md**: adding a detector with bundle = register catalog + implement bundle builder + set `label_space`.

---

## Phase 5: Cleanup and deprecation

**5.1** After one release with aliases: remove `neuroner_ner`/`presidio_ner`-specific paths; update any external clients.

**5.2** Remove dead frontend helpers and duplicated query keys.

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Bundle shape does not fit a future detector | Add `kind` + `payload` to bundle later (version bump) or reserve `label_space: "custom"` + separate extension. |
| Optional installs (Presidio/Neuro models missing) | 503 + `detail`; catalog `installed` / `ready`—surface in UI. |
| Stale client cache when switching pipe types | React Query keys include `pipeType` plus generic bundle key. |

---

## Suggested sequencing

1. Catalog `label_space` and expose on `GET /pipe-types` (no URL change yet).
2. Generic `GET …/{name}/label-space-bundle` and wire NeuroNER/Presidio plus tests.
3. Frontend: generic fetch and migration behind `label_space`.
4. Slim POST response schema; add debug query if needed.
5. Deprecate old paths; remove aliases and name-based `useLabelSpace` logic.

---

## Definition of done

- New detector can ship with **catalog/metadata + optional bundle function** without touching `pipelines.py` route list (only central dispatch).
- Playground uses **one bundle URL** and **pipe-type metadata** for label space.
- OpenAPI documents a **single** bundle response and a **single** compute response for all detectors.
