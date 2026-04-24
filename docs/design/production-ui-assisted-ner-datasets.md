# Design spec: Production UI — assisted NER dataset creation (dataset-centric)

## 1. Purpose and scope

### 1.1 Product goal

The **Production UI** (`frontend-production/`) is the primary surface for **assisted NER (or PHI-tagged) dataset creation**. The experience is **dataset-centric**: clients maintain **multiple datasets**, switch between them, and **continuously add** material to each dataset via paste, single-file upload, or batch upload. Every **file** keeps **original text**, **current annotations** (spans on that original), and a **resolved** flag. **Export output type** (`redacted` \| `annotated` \| `surrogate_annotated`) is set **once per dataset** so each export is a **homogeneous** JSONL corpus (every line uses the same `output_type`). Export scope is **all files** or **resolved only**. **All export artifacts use a single JSONL stream** (one UTF-8 JSON object per line); no BRAT folders or parallel `.txt`/`.ann` pairs in v1.

**Why per-dataset (not per-file):** Most downstream jobs expect one corpus = one contract. Per-file modes add UI clutter and make QA harder; if someone truly needs two modes, they use **two datasets** (or duplicate and re-export).

Backend contracts (aligned surrogate spans, server-side ingest) remain in [plans/ner-dataset-creation.md](../plans/ner-dataset-creation.md).

### 1.2 Non-goals (v1 UI)

- Replacing the Playground **Datasets** admin view for server-side registry CRUD (optional later: “Push dataset to server” with admin key).
- **Collaborative real-time** multi-user editing.
- **Version history** per file (beyond undo in session) — future.

---

## 2. Core concepts

### 2.1 Dataset

A **dataset** is a named working set of **files** plus shared **detection** defaults.

| Field | Description |
|-------|-------------|
| `id` | Stable client id (uuid). |
| `name` | Human label (e.g. “i2b2-style notes Q1”). |
| `createdAt` / `updatedAt` | For sorting and export manifest. |
| `defaultDetectionMode` | **Default** pipeline choice for the **Run detection** control (deploy **mode** name). Users can pick **another** available mode/pipeline on each run (§4). |
| `exportOutputType` | `redacted` \| `annotated` \| `surrogate_annotated` — applies to **every** exported line for this dataset (see §2.3). |
| `files` | Ordered list of **dataset files** (see §2.2). |

Clients **switch the active dataset** via a dataset switcher (tabs, sidebar, or dropdown). Only one dataset is **active** at a time in the main workbench; others stay in memory (persisted) and retain state.

### 2.2 Dataset file (document)

Each row is one logical document (one original text).

| Field | Description |
|-------|-------------|
| `id` | Stable client id. |
| `sourceLabel` | Filename, pasted title, or `paste-{timestamp}` — for queue display and export stem. |
| `originalText` | **Source of truth** for editing and for span offsets. Immutable unless user explicitly **Replace source** (advanced). |
| `annotations` | List of spans `{ start, end, label, … }` on **originalText**. |
| `detectionStatus` | e.g. `pending` \| `processing` \| `ready` \| `error` (mirrors today’s queue). |
| `detectedAt` | Optional snapshot of model output for “reset to detected”. |
| `lastDetectionTarget` | Optional: mode or pipeline name last used for a **successful** run on this file (provenance). |
| `resolved` | Boolean: **completed** for this file (user marks done). Drives filters and **export resolved only**. |
| `flagged` | Optional: needs attention but not “done” (orthogonal to `resolved`). |
| `note` | Free text. |
| `error` | Last detection error message. |
| `surrogateText` / `annotationsOnSurrogate` | Populated when API supports alignment; cache for preview/export. |

**Annotation rule:** All spans always reference **`originalText`**. Surrogate views and **surrogate_annotated** export use server-derived **aligned** spans only—never client-guessed offsets.

### 2.3 Export output type (per dataset)

Each **dataset** has exactly one **`exportOutputType`** for all exports from that dataset.

| `exportOutputType` | Meaning | JSONL line (see §5.3) |
|--------------------|---------|----------------------|
| **`redacted`** | Replace entities in the original string with label tokens (e.g. `[NAME]`, same semantics as API `output_mode=redacted`). **No NER spans** in each line—only **`text`** (the redacted string). | `output_type: "redacted"`, `text`, `spans: []`. |
| **`annotated`** | **Original** text plus **final** span annotations (boundaries + labels on that original). | `output_type: "annotated"`, `text` = original, `spans` = list with `start`/`end`/`label` (into `text`). |
| **`surrogate_annotated`** | **Surrogate** surface string plus spans aligned to **that** string. Requires backend alignment (see roadmap). | `output_type: "surrogate_annotated"`, `text` = surrogate, `spans` aligned to `text`; `metadata` may hold `original_text` / `original_spans` for audit. |

**UI:** **Dataset settings** strip or workbench header: **Export as** `[redacted ▼]`. **Detection pipeline** default is **`defaultDetectionMode`** (§4.1); it is independent of export type. Changing export type affects the next download only (does not rewrite stored annotations). Warn if switching from `annotated` to `redacted` with unresolved conflicts—product choice.

**Preview:** Reviewer always edits on **original**; **Preview sample line** uses the dataset’s `exportOutputType`.

**BRAT / other tools:** Consumers can convert JSONL → BRAT offline; the Production UI does not emit `.ann` in v1.

---

## 3. Ingestion (continuous)

All ingest actions append to the **active dataset**.

| Channel | Behavior |
|---------|----------|
| **Paste text** | Modal or inline field: paste → create new file with `sourceLabel` = `Pasted {time}` or user title; `originalText` = pasted content; `detectionStatus=pending`. |
| **Upload file(s)** | Same as today: multi-select `.txt` / `.jsonl`; jsonl splits into multiple files. |
| **Batch upload** | Same control as multi-file; optional **folder drop** (if ever supported in browser) — same code path. |

No need for three separate UX metaphors beyond **Paste** button + **Upload** button (upload already supports batch).

---

## 4. Detection and review

### 4.1 Selection-based detection (any pipeline, any time)

Within the **active dataset**, users run inference on a **chosen subset of files** using a **chosen pipeline** (deploy **mode** alias or allowed **pipeline** name — same resolution rules as `POST /process/{target}` today, subject to inference key allowlist).

| Selection | How |
|-----------|-----|
| **One file** | Click row → primary selection; or checkbox only that row. |
| **Multiple files** | Checkboxes + **Run detection on selection**. |
| **Entire dataset** | **Select all** in the file list (header checkbox), then run. |

**Pipeline picker:** A **Run with** `[▼]` control lists **available** modes from `GET /deploy/health` (and, if exposed to inference users, other allowed pipeline names). The pre-selected value is **`dataset.defaultDetectionMode`**; the user may change it **per run** without mutating the dataset default (optional: **“Set as dataset default”** checkbox to persist).

**Behavior for each selected file:**

1. Call `POST /process/{target}` with `output_mode=annotated` (spans on original text), same as current Production detect path.
2. **Replace** `annotations` with the new response spans — whether the file previously had **no** spans, **model** spans, or **human-edited** spans. Previous annotations are **not** merged; the run is authoritative.
3. Update **`detectedAt`** snapshot from the new model output; set **`lastDetectionTarget`** to the `target` string used.
4. Clear any cached **`surrogateText` / `annotationsOnSurrogate`** for that file (stale relative to new spans).
5. Set **`detectionStatus`** to `ready` on success, `error` on failure.

**Resolved files:** If the selection includes files marked **`resolved === true`**, show a **confirm** dialog: re-detection **replaces** annotations and typically **clears `resolved`** so the user must re-confirm quality (recommended). Alternative: **warn-only** and keep `resolved` — weaker for audit; not recommended.

**Concurrency / cancel:** Same worker-pool pattern as today; **Cancel** stops scheduling new work and leaves in-flight rows in `processing` or `error` per outcome.

### 4.2 Review

- Selecting a file opens **DocumentReviewer**: spans on **`originalText`**; mark **Resolved** for export gating.
- **Resolved vs flagged:** **Resolved** = “annotations are final for export (subject to **`exportOutputType`**).” **Flagged** = optional without marking complete.

---

## 5. Export

### 5.1 Scope

| Option | Included files |
|--------|----------------|
| **All files** | Every file in the active dataset (or in a **multi-dataset** export if ever added — v1: **active dataset only**). |
| **Resolved only** | Only files where `resolved === true`. |

Optional warning if **resolved only** is empty.

### 5.2 Per-line behavior

Read **`dataset.exportOutputType`** once. For **each** included file, append **one JSON object** (one line) using that type:

- **`redacted`:** Call `POST /process/redact` with `output_mode=redacted` (or client-side tag replace if identical). Emit line with **`text`** = redacted string, **`spans`: []**.
- **`annotated`:** Emit line with **`text`** = original, **`spans`** = finalized annotations (indices into `text`).
- **`surrogate_annotated`:** Emit line with **`text`** = surrogate, **`spans`** = aligned annotations; if API unavailable, block export or skip with clear error list (product choice).

Every line’s `output_type` field **equals** `dataset.exportOutputType` (redundant but useful for stream validation).

### 5.3 JSONL line schema (normative)

All lines are one JSON object with at least:

| Field | Type | Notes |
|-------|------|--------|
| `schema_version` | `1` | Bump when breaking. |
| `output_type` | `"redacted"` \| `"annotated"` \| `"surrogate_annotated"` | Same as **`dataset.exportOutputType`** for every line in the file. |
| `id` | string | Stable file id in the client. |
| `source_label` | string | Display / provenance (e.g. filename). |
| `text` | string | **Canonical string for this record**: redacted, original, or surrogate per `output_type`. |
| `spans` | array | Always present; **empty for `redacted`**. Each span: `start`, `end`, `label`, optional `confidence`, `source`. |
| `resolved` | boolean | Echo export-time resolved flag. |
| `metadata` | object | Optional: `note`, `dataset_name`, `reviewer`, `exported_at`, `last_detection_target`, for **`surrogate_annotated`** may include `original_text` / `original_spans` for audit. |

**Compatibility:** `annotated` lines can be transformed to Playground **`AnnotatedDocument`** shape (`document` + `spans`) in a thin adapter if we want byte-for-byte match with `corpus.jsonl` ingest—either emit that nested shape as an optional `document` field or document the flat `text`+`spans` as the Production UI dialect.

### 5.4 Download packaging

- **Default:** Single file **`corpus.jsonl`** (newline-terminated UTF-8).
- **Optional:** Same bytes inside **`export.zip`** with **`manifest.json`** (dataset name, `export_output_type`, export timestamp, line count, reviewer) for convenience—still one logical JSONL corpus inside.

---

## 6. Information architecture

### 6.1 Routes

| Route | Purpose |
|-------|---------|
| `/` | **Datasets home** — list + create dataset; pick active → **Workbench**. |
| `/d/:datasetId` | **Workbench** for one dataset (or keep single `/` with dataset id in query `?ds=` — implementation choice). |
| `/audit` | Unchanged. |

**Dataset switcher** always visible in workbench header: switch dataset without losing unsaved state (persisted store).

### 6.2 Workbench layout (wireframe)

```
┌────────────────────────────────────────────────────────────────────┐
│ Dataset [▼]  + New   Run with [mode ▼]  [Run detection]  cancel      │
│ Reviewer [____]   Export as [annotated▼]                             │
├────────────┬───────────────────────────────────────────────────────┤
│ Files      │ File: [sourceLabel]   ☑ Resolved                        │
│ [☑ all]    │ Annotations: N   Conflicts: …                          │
│ [Paste]    ├───────────────────────────────────────────────────────┤
│ [Upload]   │  Original + highlights  │  Span editor                 │
│ ☑ row …    │                         │                               │
│ Filter     └───────────────────────────────────────────────────────┘
│ All | …    │
│ Pending    │  Export: ○ All  ● Resolved only  [Download .jsonl] …    │
└────────────┴────────────────────────────────────────────────────────┘
```

- **Run detection** applies to **checked rows**; if none checked, **run on current file only** (or disable with tooltip — pick one and document).
- **Select all** checks every file in the dataset for the next run.

---

## 7. Client store (persistence)

### 7.1 Shape

```text
productionDatasets: {
  activeDatasetId: string | null
  datasets: Record<string, Dataset>   // id -> Dataset
}
```

Use **zustand + persist** with a **versioned** `migrate` function (bump `version` in persist config when schema changes). Legacy `production-queue` data can be **migrated once** into a single default dataset named “Legacy import”.

### 7.2 Defaults

- New dataset: `exportOutputType` defaults to **`annotated`**; `defaultDetectionMode` from deploy default or empty until user picks.
- Duplicating a dataset copies **`exportOutputType`** along with files.

### 7.3 Where and how to persist (recommended)

**Today:** `persist` writes **JSON** to **`localStorage`** under a single key (e.g. `production-queue`). That is fine for **small** corpora but hits **~5 MiB per-origin** limits and **main-thread** stringify/parse cost as datasets grow.

**Recommended evolution (dataset-centric + large notes):**

| Layer | What | Mechanism |
|-------|------|-----------|
| **Primary store** | Full `productionDatasets` blob (all `originalText`, spans, flags, metadata) | **IndexedDB** via a **custom `persist` `storage`** (e.g. `idb-keyval` or a tiny async wrapper). Keeps **much larger** corpora and avoids blocking the UI on every debounced keystroke if you **throttle** `setState` + persist (see below). |
| **Fallback / v0** | Same shape | `localStorage` — acceptable for MVP or “small dataset” mode. |

**Throttling / consistency**

- **Option A:** Persist on **discrete actions** only (upload complete, detection finished, mark resolved, tab blur / `beforeunload`) — simplest, fewer writes.
- **Option B:** **Debounce** persist (e.g. 1–2 s) after span edits; **flush** immediately on visibility change / unload.
- Never rely on persist mid-**processing** without writing `processing` state or accepting resume gaps.

**What to store vs omit**

| Persist | Do **not** persist in the same store |
|---------|--------------------------------------|
| Datasets, files, annotations, resolved, notes, `lastDetectionTarget`, UI prefs (last export scope) | **`VITE_API_KEY`**, passwords, tokens — keep env-only. |
| `reviewer` string (operator id) | Raw audit payloads from API if huge — trim or omit. |

**Optional “session only” mode**

- Setting or env flag: **`persist: false`** or **memory-only** store for shared clinical workstations — data lost on tab close; show banner.

**Integrity**

- Top-level **`schemaVersion`** (or zustand-persist **`version`**) + **`migrate`** for renames (`text` → `originalText`, legacy queue → datasets).
- **Export JSONL** remains the operator’s **backup**; document “download before browser data clear.”

**Security posture**

- Treat IndexedDB / localStorage as **PHI at rest** on that device — disk encryption and **Clear all data** in settings are organizational controls, not crypto in the app unless you add an explicit **passphrase + Web Crypto** layer later.

### 7.4 Storage key naming

- Prefer a **single key** per app version bucket, e.g. `clinical-deid-production:v2`, to allow side-by-side migration reads.
- Avoid scattering many small keys unless you split **metadata** vs **large text blobs** (advanced: one IDB object per file for huge corpora — only if profiling shows single-blob contention).

---

## 8. Component mapping (implementation)

| New / renamed | Responsibility |
|---------------|----------------|
| `DatasetShell` / `DatasetSwitcher` | List datasets, create/rename/delete dataset, set active. |
| `DatasetFileList` | Replaces flat `DocumentQueue`; **checkboxes**, **select all**, paste/upload, filters. |
| `DocumentReviewer` | Unchanged core; props from **active file**; **Resolved** toggle (no per-file export type). |
| `DatasetExportBar` | Scope (all \| resolved), build **JSONL** (§5.3), download `.jsonl` or `.zip` wrapper (§5.4). |
| `useBatchDetect` (or `runDetection`) | Args: `datasetId`, **`fileIds: string[]`**, **`target: string`** (mode/pipeline), replace semantics per §4.1; concurrency + cancel. |

---

## 9. API dependencies

Unchanged from prior spec: `GET /deploy/health`, `POST /process/{mode}`, `POST /process/redact`, optional batch infer, future **aligned surrogate** response for `surrogate_annotated`.

---

## 10. Security and privacy

- **localStorage** may hold **many datasets × many full texts** — stronger **disclaimer** and **Clear all data** in settings.
- JSONL **`source_label`** and **`metadata`** may contain sensitive strings; treat the download like PHI. Optional: warn before export when `metadata` includes `original_text` on surrogate lines.

---

## 11. Phased delivery

| Mile | Focus |
|------|--------|
| **M0** | Persisted **dataset** store + switcher; migrate legacy single-queue. |
| **M1** | **`exportOutputType`** on dataset + **`resolved`** on files; **§4.1** selection-based detection (checkboxes, select all, any **`target`** per run, **replace** annotations); export **all vs resolved**; **JSONL** per §5.3 for **redacted** + **annotated**. |
| **M2** | **Paste** ingest; optional **zip** wrapper + `manifest.json` (§5.4). |
| **M3** | **`surrogate_annotated`** JSONL lines wired to API; preview. |
| **M4** | Filters, virtualization, keyboard shortcuts. |

---

## 12. Future UX enhancements (recommended)

Optional polish beyond the phased milestones; prioritize by user research.

### Navigation and mental model

- **Workflow strip** in the workbench header (Ingest → Detect → Review → Export) with coarse completion state per stage.
- **Dataset home** screen: cards per dataset showing doc count, resolved count, last export time, and **`exportOutputType`** — not only a switcher dropdown.
- **Breadcrumbs:** `Datasets / {name} / {filename}` during review.

### Review efficiency

- **Keyboard-first:** list `↑/↓`, jump to next **unresolved** or next **error**; span navigation `J`/`K`; shortcut to toggle **Resolved**; **undo** last span edit (at least one step).
- **Multi-select bulk bar:** mark resolved (with guard if conflicts), remove — **re-detect** uses §4 checkboxes + **Run detection**; optional duplicate **Run on selection** in the bar for discoverability.
- **Richer list rows:** conflict indicator, span count, “never detected” vs ready.
- **Persist layout:** pane widths and active right-panel tab in `localStorage`.

### Trust, safety, PHI

- **Persistent notice** when using local persistence: data lives in the browser; link **Clear all datasets**.
- **Export confirm** when JSONL `metadata` may embed **`original_text`** (e.g. surrogate audit fields).
- **Surrogate preview** labeled as synthetic / verify-before-share.

### Scale

- **Virtualized** file list + **search** by `source_label`.
- **Detect progress** UI: per-file row updates, **Cancel**, **Retry failed only**.
- **Soft cap warning** for very large queues (performance expectations).

### Export feedback

- **Export dry-run** summary: line count, `exportOutputType`, optional **sample** (first N lines pretty-printed).
- **Post-export** confirmation: line count + file size (or checksum) for automation hooks.
- **`manifest.json`:** include `schema_version`, `export_output_type`, and **app version** string.

### Empty / error states

- **First-run** empty state: short checklist + optional sample `.txt` for demos.
- **Unavailable mode:** surface **`missing`** deps from deploy health, not only a disabled button.

### Accessibility

- Paste / modal: **focus trap**, **Escape** to close.
- Respect **`prefers-reduced-motion`** for span pulse / highlight animations.
- Optional **high-contrast** or theme hook for long sessions.

### Deferred (only if requested)

- Per-file **diff summary** (detected vs edited).
- **Dataset tags** for many-dataset power users.
- **Share links** require a backend — out of scope for local-first v1.

---

## 13. Related documents

- [NER dataset creation roadmap](../plans/ner-dataset-creation.md)
- [Deployment / auth](../deployment.md)
- [Data ingestion](../data-ingestion.md)
