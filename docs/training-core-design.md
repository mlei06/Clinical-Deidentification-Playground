# Design: training core (Phase 1)

**Status:** Design reference for the training subsystem. Implementation lives under `src/clinical_deid/training/` and is invoked via `clinical-deid train run` (requires the `[train]` extra). Runtime inference uses the **`huggingface_ner`** pipe and the filesystem model registry — not a `custom_ner` pipe name.

This document specifies fine-tuning support for encoder models (ClinicalBERT, Clinical ModernBERT, and other HF encoders) for PHI NER. The deliverable is a CLI-driven training pipeline that writes a model directory under `models/huggingface/{name}/` consumable by **`huggingface_ner`**. API endpoints, frontend UI, and CRF heads were out of scope for Phase 1.

## Goals

- One code path for two starting points: fine-tune an HF Hub base encoder and
  continue fine-tuning a local model we previously trained.
- Produce model directories that drop into `models/huggingface/{name}/`, are
  discovered by the existing `models.scan_models` scanner without code changes,
  and load cleanly through `huggingface_ner` as-is.
- Deterministic, reproducible runs: every training artifact includes the full
  `TrainingConfig` snapshot, seed, dataset identity, and metrics.
- Filesystem-first, no database changes. No migrations.

## Non-goals (Phase 1)

- CRF head. Deferred to Phase 3.
- API endpoints (`/training/jobs`) and background job runner. Deferred to Phase 2.
- Frontend training view. Deferred to Phase 2.
- Distributed / multi-GPU orchestration. Single-process, single-device only.
- Hyperparameter search. Users specify hyperparameters directly.
- Automatic dataset splitting beyond a single `eval_fraction` shuffle.

## Architecture overview

```
src/clinical_deid/training/
  __init__.py           # public surface: run_training, TrainingConfig
  config.py             # TrainingConfig pydantic model
  datasets.py           # AnnotatedDocument → HF Dataset + label alignment
  base_model.py         # resolve "hub id" vs "local:{name}" → tokenizer + model factory
  runner.py             # orchestrates tokenize / train / eval / save
  manifest.py           # write model_manifest.json v2 for the output directory
  metrics.py            # seqeval-based per-label P/R/F1
  errors.py             # TrainingError subclasses for user-facing failures
```

Two existing modules get small extensions:

- `src/clinical_deid/models.py` — `ModelInfo` gains optional fields (see §4).
- `src/clinical_deid/cli.py` — adds a `train` command group.

No changes to `huggingface_ner/pipe.py` are required for Phase 1: the pipe already
loads via `transformers.pipeline("token-classification", ...)`, which accepts
any directory saved by `Trainer.save_model()` + `AutoTokenizer.save_pretrained()`.

## Data contracts

### `TrainingConfig` (config.py)

```python
class TrainingHyperparams(BaseModel):
    epochs: float = 3.0
    learning_rate: float = 5e-5
    per_device_train_batch_size: int = 16
    per_device_eval_batch_size: int = 32
    max_length: int = 512            # token cap; ModernBERT users may raise
    warmup_ratio: float = 0.1
    weight_decay: float = 0.01
    seed: int = 42
    gradient_accumulation_steps: int = 1
    fp16: bool = False               # auto-enabled if CUDA present and user asks
    bf16: bool = False
    gradient_checkpointing: bool = False
    early_stopping_patience: int | None = None
    logging_steps: int = 50
    eval_steps: int | None = None    # None → evaluate once per epoch

class TrainingConfig(BaseModel):
    base_model: str                        # HF hub id OR "local:{model_name}"
    train_dataset: str                     # registered dataset name
    eval_dataset: str | None = None        # optional; distinct dataset for eval
    eval_fraction: float | None = None     # fallback: fraction of train_dataset
    output_name: str                       # target dir under models/huggingface/
    labels: list[str] | None = None        # if None, derived from train_dataset
    freeze_encoder: bool = False
    hyperparams: TrainingHyperparams = Field(default_factory=TrainingHyperparams)
    device: str | None = None              # "cpu"|"cuda"|"cuda:0"|"mps"; None → auto-detect: cuda→mps→cpu
    overwrite: bool = False                # if target dir exists
```

Validation rules:

- Exactly one of `eval_dataset` / `eval_fraction` may be set; both or neither is allowed (neither → no eval pass, skip metrics).
- `base_model` is a non-empty string. If it starts with `local:`, the remainder must match an existing model in `models_dir` whose `framework == "huggingface"`.
- `output_name` must pass the same safe-name regex used by `dataset_store._validate_name` (`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`) and must not equal the resolved `local:` base model name unless `overwrite=True` (prevents self-clobber during continued training).
- `labels`, if provided, must be non-empty and deduplicated; reserved tag `O` is not allowed as a label (it is implicit).

### Model manifest v2

Existing v1 fields keep their meaning. Add these, all optional on read:

```jsonc
{
  "name": "clinical-bert-i2b2-v1",
  "framework": "huggingface",
  "labels": ["NAME", "DATE", "PHONE", ...],

  // v2 additions
  "schema_version": 2,
  "base_model": "emilyalsentzer/Bio_ClinicalBERT",
  "parent_model": null,                    // or "clinical-bert-i2b2-v0" for continued runs
  "tokenizer": "emilyalsentzer/Bio_ClinicalBERT",
  "has_crf": false,                        // Phase 3
  "training_config": { /* TrainingConfig snapshot */ },
  "training": {
    "trained_at": "2026-04-19T14:20:00Z",
    "train_dataset": "i2b2-2014",
    "train_documents": 790,
    "eval_dataset": null,
    "eval_fraction": 0.1,
    "eval_documents": 79,
    "seed": 42,
    "device_used": "cuda:0",
    "total_steps": 1500,
    "train_runtime_sec": 412.3,
    "bio_labels": ["O", "B-NAME", "I-NAME", "B-DATE", "I-DATE", "..."],
    "head_reinitialised": false
  },
  "metrics": {
    "overall": { "precision": 0.942, "recall": 0.918, "f1": 0.930 },
    "per_label": {
      "NAME": { "precision": 0.97, "recall": 0.95, "f1": 0.96, "support": 1230 },
      ...
    },
    "confusion": null                      // left empty for Phase 1; future
  }
}
```

`models.py::_load_manifest` must remain permissive: any v1 manifest must still
parse. Add the new fields to `ModelInfo` as optional, defaulting to `None` /
`{}`. Leave the invariant `name == directory name` in place.

## Base-model resolution (base_model.py)

A single function resolves both starting points:

```python
@dataclass(frozen=True)
class ResolvedBaseModel:
    kind: Literal["hub", "local"]
    source: str                    # hub id or absolute path
    parent_model_name: str | None  # for local; None for hub
    saved_label_space: list[str]   # empty for hub, manifest labels for local
    tokenizer_source: str

def resolve_base_model(
    ref: str,
    models_dir: Path,
) -> ResolvedBaseModel: ...
```

Behavior:

- `ref` starts with `local:` → look up via `models.get_model`. Must be `framework == "huggingface"`. `source` is the absolute model path; `tokenizer_source` is the same path (the local dir always ships its tokenizer). `saved_label_space` is the manifest's `labels`. `parent_model_name` is the local name.
- Otherwise → treat as HF Hub id (no validation against the hub — let transformers raise at load time; surface that error cleanly in `errors.py`). `tokenizer_source` equals `source`. `saved_label_space` is `[]`.

Model construction uses `AutoModelForTokenClassification.from_pretrained(
source, num_labels=<derived>, id2label=..., label2id=...)`.

Two cases for label space compatibility when continuing from a local model:

1. **Same label space as parent** (common): training config omits `labels` or
   provides an identical list; the existing classifier head is preserved.
   `from_pretrained` reloads the head weights.
2. **Different label space** (e.g. add `FIRST_NAME`/`LAST_NAME` to a parent that
   only had `NAME`): transformers' `from_pretrained` with a different
   `num_labels` reinitialises the classification head. We must detect this
   case, log a prominent warning (`"classifier head reinitialised: parent had
   N labels, new config has M"`), and record `head_reinitialised: true` in the
   manifest's `training` block. No automatic label remapping — that is a
   dataset-curation decision the user should make explicitly.

`freeze_encoder=True` freezes everything except the classification head via
`for name, p in model.named_parameters(): p.requires_grad = name.startswith(
"classifier")`. Use the HF convention that the top module is named `classifier`
for AutoModelForTokenClassification; verify at runtime and raise a clear error
if the module tree differs.

## Label space and tokenization alignment (datasets.py)

This is the subtle part. `training_export._bio_tags` produces BIO tags over
whitespace tokens — correct for *export*, wrong for *training*. Transformer
models tokenize into subwords; labels must be aligned per subword with `-100`
on continuation subwords so the loss ignores them.

### Label derivation

```python
def derive_label_list(
    docs: Iterable[AnnotatedDocument],
    override: list[str] | None,
) -> list[str]:
    """Return ordered list [O, B-L1, I-L1, B-L2, I-L2, ...].

    O is always index 0. Labels are sorted for determinism.
    """
```

Store this list in `TrainingConfig.labels` (the user-facing list — canonical
labels without BIO prefixes). Expand to BIO internally. Persist both in the
manifest: `labels` is the user-facing list (matches v1 semantics for the pipe
loader), and `training.bio_labels` is the expanded list used as the model's
`id2label`.

### Alignment function

```python
def tokenize_and_align(
    doc: AnnotatedDocument,
    tokenizer: PreTrainedTokenizerFast,
    bio_label_to_id: dict[str, int],
    max_length: int,
    stride: int = 0,              # Phase 1: no sliding window
) -> dict[str, list[int]]:
    """Returns {input_ids, attention_mask, labels} aligned to subwords."""
```

Algorithm:

1. `enc = tokenizer(doc.document.text, return_offsets_mapping=True,
   truncation=True, max_length=max_length, return_special_tokens_mask=True)`.
   Require a fast tokenizer (raise `TrainingError` if `.is_fast` is false) —
   slow tokenizers expose `word_ids()` on the encoding; slow tokenizers do not.
2. For each subword token position `i`:
   - `enc.word_ids()[i] is None` (special token like `[CLS]`, `[SEP]`, `[PAD]`) → label id `-100`.
   - `enc.word_ids()[i]` equals the same word index as position `i-1` (continuation subword of the same original word) → `-100`. The loss must not fire on these positions.
   - Otherwise (first subword of a new original word): look up the character offset of that word via `enc.offset_mapping[i]` and find which span, if any, covers it. Span lookup uses a precomputed sweep for O(n+m).
     - No span covers this word → `O`.
     - A span covers this word and it is the **first word of the span** (word offset ≤ span start) → `B-<label>`.
     - A span covers this word and it is a **continuation word within the span** → `I-<label>`.

   Concrete example — `"John Smith"` labelled `NAME`, tokenised as `["[CLS]","John","Smith","[SEP]"]`:
   - `[CLS]` → `-100` (special)
   - `"John"` → `B-NAME` (first subword of word 0; word 0 is the first word of the span)
   - `"Smith"` → `I-NAME` (first subword of word 1; word 1 continues the span)
   - `[SEP]` → `-100` (special)

   If `"Smith"` instead tokenised into two subwords `["Sm","##ith"]`:
   - `"Sm"` → `I-NAME` (first subword of word 1)
   - `"##ith"` → `-100` (continuation subword of word 1 — NOT `I-NAME`)

3. Overlap policy: take the *longest* span covering a word, matching the
   existing `longest_non_overlapping` convention already used in combinators.
   Truncated entities at the `max_length` boundary retain their leading BIO
   labels; the truncated tail is silently dropped.

### Dataset wiring

```python
def build_hf_datasets(
    cfg: TrainingConfig,
    corpora_dir: Path,
) -> tuple[datasets.Dataset, datasets.Dataset | None, list[str]]:
    """Returns (train_ds, eval_ds_or_None, bio_labels)."""
```

- Load via `dataset_store.load_dataset_documents(corpora_dir, name)`.
  Manifests live at `corpora_dir/{name}/dataset.json` with corpus bytes in the same directory.
- If `eval_dataset` is set, load separately.
- Else if `eval_fraction` is set, shuffle train with `hyperparams.seed` and
  slice. Do not touch the underlying JSON manifests.
- Derive label space from `cfg.labels` or from *both* splits combined (so the
  eval split can't introduce unseen labels that `seqeval` then flags as errors).
- Map each `AnnotatedDocument` through `tokenize_and_align`.
- Return plain `datasets.Dataset` objects with columns
  `{input_ids, attention_mask, labels}`. No tensor conversion — `Trainer`
  handles that via `DataCollatorForTokenClassification`.

## Training flow (runner.py)

```python
def run_training(cfg: TrainingConfig, *, models_dir: Path, corpora_dir: Path) -> Path:
    """End-to-end training. Returns the output model directory path."""
```

Steps:

1. **Validate config** (cfg.model_validate performs schema checks; runner adds
   path checks).
2. **Guard output directory**: if `models/huggingface/{output_name}/` exists
   and `cfg.overwrite` is false, raise `OutputExists`. All writes go into a
   temp sibling directory (`{output_name}.tmp.<pid>/`) so the final path is
   never left in a partial state.
3. **Resolve base model**: `resolve_base_model(cfg.base_model, models_dir)`.
4. **Build datasets and label space**.
5. **Detect and log device**: when `cfg.device` is `None`, auto-detect in order
   `cuda` → `mps` → `cpu`; print the chosen device to the terminal before
   training starts. Honour an explicit `cfg.device` value without validation
   (let PyTorch raise on an invalid device string).
6. **Load tokenizer and model**: `AutoTokenizer.from_pretrained(source, use_fast=True)`
   and `AutoModelForTokenClassification.from_pretrained(source, num_labels,
   id2label, label2id, ignore_mismatched_sizes=True)`.
   When `num_labels` differs from the parent model's head size, log at WARNING,
   print a clearly formatted note to the terminal, and record
   `head_reinitialised: true` in the manifest's `training` block.
7. **Apply `freeze_encoder`** if requested.
8. **Seed**: `transformers.set_seed(cfg.hyperparams.seed)`. Do not call
   `torch.use_deterministic_algorithms` — leave the user's global setting alone.
9. **Build `TrainingArguments`**: map from `TrainingHyperparams`. `output_dir`
   is `staging/checkpoints/`. `save_strategy="epoch"` by default;
   `load_best_model_at_end=True` when eval is enabled. Evaluation strategy
   mirrors `save_strategy`.
10. **Build `Trainer`** with `DataCollatorForTokenClassification`, our
    `metrics.compute_metrics` (see below), and `EarlyStoppingCallback` when
    `early_stopping_patience` is set and eval is enabled.
11. **Train**: `trainer.train()`. Capture runtime and total step count.
12. **Final eval** (if eval enabled): `trainer.evaluate()` → per-label report.
13. **Save model and tokenizer** into `staging/model/`:
    `trainer.save_model(staging/model/)` and
    `tokenizer.save_pretrained(staging/model/)`.
14. **Copy Trainer artifacts** from `staging/checkpoints/` into
    `staging/model/training/`: `trainer_state.json`, `training_args.bin`.
    Write `train.log` (captured stdout/stderr) to the same directory.
15. **Delete checkpoints** (`staging/checkpoints/`) unless `--keep-checkpoints`
    is passed.
16. **Write manifest v2** to `staging/model/model_manifest.json` (manifest.py).
17. **Atomic promotion**: `shutil.move(staging/model/, final_dir/)`. This is the
    only step that touches the real output path. On success, delete the now-empty
    `staging/` directory. On any failure before this point, leave `staging/`
    intact (useful for debugging) and re-raise.
18. Return the final path.

On failure: `staging/` is left on disk. On success: only the final directory
exists; `staging/` is gone. This guarantees the real output path is either
absent or complete — never partial.

Training artifacts kept inside the model directory:

```
models/huggingface/clinical-bert-i2b2-v1/
  model_manifest.json
  config.json                     # from transformers
  pytorch_model.bin | model.safetensors
  tokenizer.json / tokenizer_config.json / special_tokens_map.json / vocab.*
  training/
    trainer_state.json            # from Trainer (keep for reproducibility)
    training_args.bin             # from Trainer
    train.log                     # captured stdout/stderr from our logger
```

## Metrics (metrics.py)

Implement a single `compute_metrics` passed to `Trainer`. Use `seqeval` for
entity-level P/R/F1 and macro-averaged F1. Return flat dict keyed as
`eval_precision`, `eval_recall`, `eval_f1`, plus per-label keys
`eval_{label}_f1`. Record the full breakdown separately in the manifest.

Add `seqeval` to the new `[train]` extra.

## Pipe integration

The existing `huggingface_ner` pipe (loaded via `transformers.pipeline(
"token-classification", aggregation_strategy="simple")`) works with any model
that has `config.id2label` populated. `Trainer.save_model()` writes that into
`config.json`. No change needed in `huggingface_ner/pipe.py` for Phase 1.

Two label representations coexist deliberately:

- `config.json::id2label` — BIO labels (`"B-NAME"`, `"I-NAME"`, `"O"`, …). Used by
  `transformers.pipeline` at inference time; the pipe never reads this directly.
- `model_manifest.json::labels` — user-facing canonical list (`["NAME", "DATE", …]`,
  no BIO prefixes). Used by the pipeline system's label introspection (`base_labels`,
  `label_space_bundle_fn`) and the frontend label picker. Matches v1 semantics.

These are intentionally separate. `transformers.pipeline` with
`aggregation_strategy="simple"` strips BIO prefixes and returns entity-level
spans, so `huggingface_ner` receives `"NAME"` not `"B-NAME"` — exactly what the
manifest's `labels` list advertises. No reconciliation is needed at inference time.

Manifest schema-version awareness:

- `models.py::_load_manifest` accepts both v1 and v2. When
  `schema_version` is missing, treat as v1.
- `huggingface_ner`'s `base_labels` already reads `manifest.labels`, which stays the
  user-facing canonical list in both versions.

## CLI surface (cli.py)

Add a new command group:

```
clinical-deid train run         # primary command
clinical-deid train list        # list local models (alias to `models list`-like view; optional)
clinical-deid train show NAME   # print manifest, metrics, parent
```

`train run` accepts either a full config file or flags for the common case:

```
clinical-deid train run \
  --base emilyalsentzer/Bio_ClinicalBERT \
  --train-dataset i2b2-2014 \
  --eval-fraction 0.1 \
  --output clinical-bert-i2b2-v1 \
  --epochs 5 --lr 3e-5 --batch-size 16 --max-length 512

clinical-deid train run \
  --base local:clinical-bert-i2b2-v1 \
  --train-dataset internal-2026 \
  --output clinical-bert-i2b2-internal-v2 \
  --freeze-encoder --epochs 3

clinical-deid train run --config training/my_run.json
```

Flag-to-config mapping is mechanical; when `--config` is given, other flags
are rejected to avoid silent overrides (pick one source of truth).

## Optional dependencies

Add a new extra to `pyproject.toml`:

```toml
train = [
    "transformers>=4.44.0",
    "torch>=2.2.0",
    "datasets>=2.20.0",
    "seqeval>=1.2.2",
    "accelerate>=0.33.0",
]
```

Import gracefully: `training/__init__.py` tries to import transformers/torch
once at module load and raises a clean `ImportError` message pointing to
`pip install '.[train]'` if unavailable. The `clinical-deid train` CLI group
registers regardless (so `--help` works), but commands fail fast with the
install hint.

Also extend the `all` extra: `"clinical-deid-playground[dev,presidio,ner,llm,parquet,train]"`.

## Error handling (errors.py)

User-facing failures throw subclasses so the CLI can show actionable messages
without a stack trace:

- `TrainingError` (base).
- `BaseModelNotFound` — `local:` reference that doesn't resolve.
- `IncompatibleFramework` — local base isn't `huggingface`.
- `OutputExists` — target directory exists and `overwrite=False`.
- `SlowTokenizerUnsupported` — base model has no fast tokenizer.
- `EmptyDataset` — train split has zero documents.
- `NoLabelsFound` — after derivation, only `O` is present.

Everything else propagates normally (OOM, CUDA errors) so users can read the
real traceback.

## Testing strategy (tests/training/)

Run all training tests with a tiny public encoder:
`hf-internal-testing/tiny-bert` (≈1 MB, CPU-only). Gate them behind a
`@pytest.mark.train` marker so CI can opt in without paying the transformers
import cost on every run.

- `test_config.py` — schema validation, mutual exclusion of `eval_dataset` /
  `eval_fraction`, safe-name check, `local:` format.
- `test_base_model.py` — `local:` resolution success and error cases, hub ids
  pass through.
- `test_datasets.py` — BIO label derivation determinism, subword alignment
  for: single-token entity, multi-subword entity, entity at boundary of
  `max_length`, overlapping spans (longest wins), special tokens get `-100`,
  continuation subwords get `-100`.
- `test_manifest.py` — v1 manifests load unchanged; v2 round-trips; missing
  fields default correctly.
- `test_runner.py` — integration: train 1 epoch on 4 synthetic documents,
  assert directory structure, manifest contents, and that
  `HuggingfaceNerPipe(HuggingfaceNerConfig(model="<output>"))` loads and predicts.
- `test_runner.py::test_continue_from_local` — same, starting from a local
  model produced by the previous test (chain).
- `test_runner.py::test_freeze_encoder` — assert encoder params have
  `requires_grad=False` and only the classifier is updated (loss must still
  decrease on the toy task).
- `test_runner.py::test_atomic_failure` — force a write failure mid-save; the
  final output directory must not exist.

Use `tmp_path` for `models_dir` and `corpora_dir` per the project's existing
convention. Seed every test.

## Phase 1 acceptance criteria

A user can:

1. `pip install '.[train]'`
2. Register a PHI dataset via the existing CLI.
3. Run `clinical-deid train run --base emilyalsentzer/Bio_ClinicalBERT
   --train-dataset <name> --output <name> --eval-fraction 0.1 --epochs 3` and
   get a completed directory under `models/huggingface/<name>/` with a valid
   v2 manifest.
4. Reference that model in a pipeline JSON:
   `{"pipes": [{"type": "huggingface_ner", "config": {"model": "<name>"}}]}`
   and run `clinical-deid run --pipeline <pipeline_name>` against text,
   getting spans back.
5. Run a second training with `--base local:<name>` on a different dataset
   and produce a new directory whose manifest's `parent_model` points at the
   first.

All tests under `tests/training/` pass with the `train` marker enabled.

## Out of scope / follow-ups

- `/training/jobs` API, subprocess runner, SSE logs — Phase 2.
- Train/eval UI, live loss chart, model picker with lineage — Phase 2.
- CRF head, custom save/load/decoder path — Phase 3.
- Hyperparameter sweeps, ensembling, k-fold — future.
- Pushing trained models to HF Hub — future.

## Open questions

1. Should we support sliding-window tokenization (`stride > 0`) for documents
   longer than `max_length`? Phase 1 truncates silently and logs a warning per
   document that is truncated. Clinical notes often exceed 512 tokens;
   ModernBERT at 8192 side-steps this. Recommend deferring until we see
   measurable degradation on a real corpus.
