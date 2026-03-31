# Model Registry

The platform uses a **filesystem-based model registry** — no database tables, no upload API. Drop model artifacts into the right directory, add a manifest, and reference the model from pipe configs.

## Directory layout

```
models/
├── spacy/
│   └── deid-ner-v1/
│       ├── model_manifest.json
│       └── model-best/          # spaCy model directory
├── huggingface/
│   └── deid-roberta-i2b2/
│       ├── model_manifest.json
│       ├── config.json          # HF model files
│       ├── pytorch_model.bin
│       └── tokenizer/
└── external/
    └── presidio-default/
        └── model_manifest.json  # metadata-only (model lives elsewhere)
```

## Supported frameworks

| Framework | Use case |
|-----------|---------|
| `spacy` | spaCy NER models (`.forward()` via `spacy.load()`) |
| `huggingface` | HuggingFace Transformers (token classification) |
| `external` | Third-party models managed outside this repo (Presidio, cloud APIs) |

## Model manifest

Each model directory must contain a `model_manifest.json`:

```json
{
  "name": "deid-ner-v1",
  "framework": "spacy",
  "labels": ["PATIENT", "DATE", "HOSPITAL", "PHONE", "LOCATION_OTHER"],
  "base_model": "en_core_web_lg",
  "dataset": "physionet-i2b2",
  "metrics": {
    "f1": 0.92,
    "precision": 0.91,
    "recall": 0.93
  },
  "device": "cpu",
  "created_at": "2024-06-15T10:30:00Z"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Must match the directory name |
| `framework` | yes | One of `spacy`, `huggingface`, `external` |
| `labels` | no | Entity types the model can detect |
| `base_model` | no | Parent model used for fine-tuning |
| `dataset` | no | Training dataset name |
| `metrics` | no | Evaluation metrics (freeform dict) |
| `device` | no | Target device (`cpu`, `cuda`, `mps`) |
| `created_at` | no | ISO 8601 timestamp |

## Discovery

The registry scans `models/{framework}/{name}/model_manifest.json` on each call:

```python
from clinical_deid.models import list_models, get_model, scan_models

# List all models
for model in list_models():
    print(f"{model.framework}/{model.name} — labels: {model.labels}")

# Filter by framework
spacy_models = list_models(framework="spacy")

# Get a specific model
model = get_model("deid-ner-v1")
print(model.path)  # Path to model directory
```

The `models_dir` defaults to `models/` in the project root. Override it with `CLINICAL_DEID_MODELS_DIR` or in code via `Settings.models_dir`.

## Using models in pipes

### spaCy NER pipe (planned)

```json
{
  "type": "spacy_ner",
  "config": {
    "model_name": "deid-ner-v1"
  }
}
```

The pipe looks up the model via `get_model()`, loads it with `spacy.load(model.path / "model-best")`, and uses it for NER inference.

### Presidio with custom models

Presidio can use models from the registry by referencing them in its model string:

```json
{
  "type": "presidio_ner",
  "config": {
    "model": "HuggingFace/obi/deid_roberta_i2b2"
  }
}
```

For local models, point Presidio at the model path directly via the Presidio configuration.

## Training workflow

The registry is the output target for the training loop:

1. **Prepare data** — Use [data ingestion](data-ingestion.md) and [transforms](transforms-and-composition.md) to build a training corpus.
2. **Export** — Convert to framework-specific format (spaCy DocBin, HuggingFace JSONL, CoNLL). _Export utilities are planned._
3. **Train** — Run your trainer of choice (spaCy CLI, HuggingFace Trainer, etc.) outside this platform.
4. **Register** — Copy the checkpoint into `models/{framework}/{name}/` and add a `model_manifest.json`.
5. **Use** — Reference the model name in a pipe config.

## Read-only API (planned)

A read-only API for listing available models is planned:

```
GET /models              — List all models
GET /models/{name}       — Model detail
```

Training is always local — there is no API for uploading or training models.
