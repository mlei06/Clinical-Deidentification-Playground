# Data Directory

Workspace for **raw corpora, transformed datasets, and training exports** that feed **local model training** and offline evaluation. It complements the HTTP API: ingest and analytics are available via **Python APIs and CLI scripts** documented in the root [README](../README.md).

All contents are git-ignored except `.gitkeep` placeholders.

```
data/
  raw/                  Unprocessed source files before ingestion
  corpora/              Annotated datasets — gold, transformed, synthesized, merged
    physionet/
      brat/             train/valid/test splits with .txt/.ann pairs
      jsonl/            Same data in JSONL format
    asq_phi/
    sredh_chatgpt/
    physionet-augmented/ (example: output of transform/synthesis)
    combined-v1/         (example: output of compose)
  exports/              Training-ready formats (spaCy .spacy, HF datasets, CoNLL)
    spacy/
    huggingface/
  synthetic/            Generation inputs (prompt templates, synthesis configs)
  evaluations/          Pipeline evaluation results (metrics, per-doc, confusion)
```

`corpora/` is the single home for all annotated datasets regardless of how they were produced — original ingestion, transforms, synthesis, or merging. They all share the same JSONL/BRAT format and are interchangeable as inputs to training, evaluation, and further transforms.

| Directory | Purpose | Typical commands |
|-----------|---------|-----------------|
| `raw/` | Drop source files before ingestion | `scripts/process_*.py` |
| `corpora/` | All annotated datasets (gold + derived) | `scripts/transform_dataset.py`, `scripts/compose_datasets.py`, `scripts/dataset_analytics.py` |
| `exports/` | Framework-specific training formats | `clinical-deid export` (planned) |
| `synthetic/` | Prompt templates and synthesis configs | LLM synthesis scripts |
| `evaluations/` | Pipeline evaluation outputs | `clinical-deid eval` (planned) |
