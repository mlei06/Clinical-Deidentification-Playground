# Pipes and Pipelines

The pipe system is the core abstraction for PHI detection and text transformation. Every operation on clinical text — detecting entities, filtering false positives, remapping labels, redacting text — is a **pipe** that transforms an `AnnotatedDocument`.

## Core concepts

### AnnotatedDocument

The universal data type flowing through every pipe:

```python
@dataclass
class Document:
    id: str
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)

@dataclass
class PHISpan:
    start: int          # character offset (inclusive)
    end: int            # character offset (exclusive)
    label: str          # entity type, e.g. "PATIENT", "DATE"
    confidence: float | None = None
    source: str | None = None       # which pipe produced this span

@dataclass
class AnnotatedDocument:
    document: Document
    spans: list[PHISpan]
```

### Pipe protocol

Every pipe implements:

```python
class Pipe(Protocol):
    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument: ...
```

Input document in, annotated document out. Pipes are pure transformations — they don't mutate the input.

### Pipe roles

Pipes are grouped by what they do:

| Role | Protocol | What it does |
|------|----------|-------------|
| **Detector** | `Detector` | Adds spans to the document (PHI detection) |
| **SpanTransformer** | `SpanTransformer` | Modifies, filters, or merges existing spans |
| **Redactor** | `Redactor` | Transforms the document text (replaces PHI with placeholders) |
| **Preprocessor** | `Preprocessor` | Modifies text before detection (e.g. normalisation) |

Detectors additionally expose a `labels` property listing the entity types they can detect.

## Built-in pipes

### Detectors

#### `regex_ner` — Regex pattern matching

Detects PHI using compiled regex patterns. Ships with built-in patterns for common entity types.

```json
{"type": "regex_ner", "config": {}}
```

**Built-in labels:** `DATE`, `PHONE`, `EMAIL`, `ID`, `MRN`, `POSTAL_CODE_CA`, `OHIP`, `SIN`, `SSN`

To use only specific labels:

```json
{"type": "regex_ner", "config": {"labels": ["DATE", "PHONE", "EMAIL"]}}
```

Custom patterns per label:

```json
{
  "type": "regex_ner",
  "config": {
    "per_label": {
      "CUSTOM_ID": {
        "patterns": ["\\bCID-\\d{6}\\b"]
      }
    }
  }
}
```

Supports label mapping to rename output labels:

```json
{
  "type": "regex_ner",
  "config": {
    "label_mapping": {"MRN": "IDNUM", "SIN": "IDNUM"}
  }
}
```

#### `whitelist` — Dictionary/phrase matching

Matches exact phrases from term lists. Ships with bundled lists for common entity types.

```json
{"type": "whitelist", "config": {}}
```

Custom terms per label:

```json
{
  "type": "whitelist",
  "config": {
    "per_label": {
      "HOSPITAL": {
        "terms": ["Mass General", "MGH", "Brigham and Women's"]
      }
    }
  }
}
```

Terms are matched with flexible whitespace (multiple spaces, tabs, newlines all match). The UI supports uploading `.txt` files (one term per line) via the `/pipelines/whitelist/parse-lists` endpoint.

#### `presidio_ner` — Microsoft Presidio

Wraps the Presidio Analyzer for NER-based detection.

**Requires:** `pip install -e ".[presidio]"`

```json
{
  "type": "presidio_ner",
  "config": {
    "model": "spacy/en_core_web_lg",
    "score_threshold": 0.4,
    "entities": {
      "PERSON": "PATIENT",
      "DATE_TIME": "DATE",
      "LOCATION": "LOCATION_OTHER"
    }
  }
}
```

| Config field | Purpose |
|-------------|---------|
| `model` | Presidio model string (e.g. `spacy/en_core_web_lg`, `HuggingFace/obi/deid_roberta_i2b2`) |
| `score_threshold` | Minimum confidence score (0.0–1.0) |
| `entities` | Map Presidio entity types to your label set |

#### `pydeid_ner` — pyDeid library

Wraps the pyDeid rule-based PHI detector.

**Requires:** `pip install -e ".[pydeid]"`

```json
{
  "type": "pydeid_ner",
  "config": {
    "phi_types": ["dates", "names", "locations", "ids", "contact"],
    "label_mapping": {"PERSON": "PATIENT"}
  }
}
```

| Config field | Purpose |
|-------------|---------|
| `phi_types` | Which pyDeid detection categories to enable |
| `date_validation` | Enable/disable date validation |
| `label_mapping` | Rename pyDeid output labels |

### Span transformers

#### `blacklist` — False positive filter

Removes detected spans that match benign vocabulary (common words, medical terms that look like names, etc.).

```json
{
  "type": "blacklist",
  "config": {
    "mode": "any_token",
    "terms": ["Dr", "Mr", "Mrs", "mg", "mL"]
  }
}
```

**Match modes:**

| Mode | Behaviour |
|------|-----------|
| `any_token` | Remove span if any whitespace-delimited token matches a term |
| `whole_span` | Remove span only if the entire text (whitespace-normalized) matches a term |
| `substring` | Remove span if any term appears as a substring |
| `overlap_document` | Remove spans overlapping blacklist regions (literal terms + regex patterns) in the full document text |

Ships with a bundled `notes_common.txt` blacklist. Per-label filtering is also supported:

```json
{
  "type": "blacklist",
  "config": {
    "mode": "any_token",
    "terms": ["Dr", "Mr"],
    "labels": ["PATIENT"]
  }
}
```

#### `resolve_spans` — Span deduplication and overlap resolution

Merges or filters overlapping spans produced by detectors.

```json
{"type": "resolve_spans", "config": {"strategy": "longest_non_overlapping"}}
```

**Strategies:**

| Strategy | Behaviour |
|----------|-----------|
| `union` | Keep all spans (no dedup) |
| `exact_dedupe` | Drop spans with identical start, end, and label |
| `consensus` | Keep spans agreed upon by multiple groups |
| `max_confidence` | Greedy selection by highest confidence score |
| `longest_non_overlapping` | Greedy selection by span length |

### Redactors

#### `presidio_anonymizer` — Text anonymization

Replaces detected PHI spans in the document text using Presidio Anonymizer operators.

**Requires:** `pip install -e ".[presidio]"`

```json
{
  "type": "presidio_anonymizer",
  "config": {
    "operator": "replace"
  }
}
```

**Operators:**

| Operator | Result | Example |
|----------|--------|---------|
| `replace` | `[LABEL]` placeholder | `[PATIENT]` |
| `redact` | Remove text entirely | _(empty)_ |
| `mask` | Character masking | `****` |
| `hash` | SHA-256 hash | `a1b2c3...` |
| `encrypt` | AES encryption | _(encrypted bytes)_ |
| `keep` | No change | Original text |

### Built-in combinators

These are not registered as pipe types but are used internally by the pipeline builder:

| Combinator | Purpose |
|-----------|---------|
| `LabelMapper` | Remaps span labels via a dict |
| `LabelFilter` | Keeps or drops specific labels |
| `ParallelDetectors` | Runs multiple detectors and merges results |
| `Pipeline` | Sequential execution of pipe list |

## Pipeline configuration

A pipeline is a JSON document that defines a sequence of pipes:

### Sequential pipeline

```json
{
  "pipes": [
    {"type": "regex_ner", "config": {}},
    {"type": "whitelist", "config": {}},
    {"type": "resolve_spans", "config": {"strategy": "longest_non_overlapping"}}
  ]
}
```

Pipes execute in order. Each pipe receives the output of the previous one.

### Parallel detection with merge

Run multiple detectors in parallel and merge their results:

```json
{
  "pipes": [
    {
      "type": "parallel",
      "detectors": [
        {"type": "regex_ner", "config": {}},
        {"type": "presidio_ner", "config": {"model": "spacy/en_core_web_lg"}}
      ],
      "merge_strategy": "max_confidence"
    },
    {"type": "resolve_spans", "config": {"strategy": "longest_non_overlapping"}}
  ]
}
```

**Merge strategies** for parallel blocks are the same as `resolve_spans` strategies: `union`, `exact_dedupe`, `consensus`, `max_confidence`, `longest_non_overlapping`.

### Intermediary tracing

Tracing is a runtime option, not part of the pipeline config. Pass `?trace=true` as a query parameter on the process endpoint to capture the document state after every pipeline step:

```
POST /process/my-pipeline?trace=true
```

The API response includes an `intermediary_trace` array with one snapshot per step.

## Adding a new pipe

Adding a detector requires three things: a config, a pipe class, and a registration call.

### Step 1: Define the config

Create a Pydantic model for your pipe's configuration:

```python
# src/clinical_deid/pipes/my_detector/pipe.py
from __future__ import annotations
from pydantic import BaseModel, Field

class MyDetectorConfig(BaseModel):
    threshold: float = Field(0.5, description="Minimum confidence", ge=0.0, le=1.0)
    labels: list[str] = Field(default_factory=lambda: ["PATIENT", "DATE"])
```

Use `Field()` with `description` for automatic UI form generation. Additional UI hints are available via the `ui_*` class-var convention:

```python
class MyDetectorConfig(BaseModel):
    model_path: str = Field("", description="Path to model checkpoint")
    model_path_ui_widget: ClassVar[str] = "file"  # renders as file picker in UI
```

### Step 2: Implement the pipe

```python
from clinical_deid.domain import AnnotatedDocument, PHISpan

class MyDetectorPipe:
    def __init__(self, config: MyDetectorConfig) -> None:
        self.config = config
        # Expensive init (load model, compile patterns, etc.)

    @property
    def labels(self) -> list[str]:
        return self.config.labels

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        new_spans = []
        # ... your detection logic ...
        # Example: find all "SECRET" substrings
        text = doc.document.text
        import re
        for m in re.finditer(r"SECRET", text):
            new_spans.append(PHISpan(
                start=m.start(),
                end=m.end(),
                label="SECRET",
                confidence=1.0,
                source="my_detector",
            ))
        return AnnotatedDocument(
            document=doc.document,
            spans=[*doc.spans, *new_spans],
        )
```

Key rules:
- **Don't mutate the input** — return a new `AnnotatedDocument`.
- **Append to existing spans** — detectors add to `doc.spans`, they don't replace them.
- **Set `source`** — helps with debugging and tracing.

### Step 3: Register

**For built-in pipes**, add a single `PipeCatalogEntry` to the `_CATALOG` list in `registry.py`. The `config_path` and `pipe_path` fields use `"module:Class"` format. `_register_builtins()` imports and registers every catalog entry automatically (optional deps are silently skipped):

```python
PipeCatalogEntry(
    name="my_detector",
    description="My custom PHI detector",
    role="detector",
    extra="my_extra",                # None if always available
    install_hint="pip install '.[my_extra]'",
    config_path="clinical_deid.pipes.my_detector.pipe:MyDetectorConfig",
    pipe_path="clinical_deid.pipes.my_detector.pipe:MyDetectorPipe",
),
```

**For external/plugin pipes**, call `register()` directly from your package:

```python
from clinical_deid.pipes.registry import register
from my_plugin.pipe import MyDetectorConfig, MyDetectorPipe

register("my_detector", MyDetectorConfig, MyDetectorPipe)
```

### Step 5 (optional): Label mapping support

If your detector should support label remapping, use the `DetectorWithLabelMapping` protocol and the shared utilities:

```python
from clinical_deid.pipes.detector_label_mapping import (
    apply_detector_label_mapping,
    detector_label_mapping_field,
)

class MyDetectorConfig(BaseModel):
    label_mapping: dict[str, str | None] = detector_label_mapping_field()

class MyDetectorPipe:
    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        # ... detect spans ...
        mapped_spans = apply_detector_label_mapping(new_spans, self.config.label_mapping)
        return AnnotatedDocument(document=doc.document, spans=[*doc.spans, *mapped_spans])
```

Setting a label to `null` in the mapping drops those spans entirely.

## Pipeline execution flow

When the API receives a `POST /process/{pipeline_id}`:

1. **Lookup** — Fetch the pipeline record and its current version from SQLite.
2. **Cache** — Check the in-memory LRU cache (max 32 entries, keyed by config hash). If miss, build the pipe chain from the JSON config.
3. **Build** — `load_pipeline(config)` deserialises each pipe step, instantiates configs and pipe objects, and composes them into a `Pipeline` (sequential) or `ParallelDetectors` (parallel blocks).
4. **Execute** — Call `pipe_chain.forward(doc)` (or `pipe_chain.run(doc, trace=True)` for intermediary capture).
5. **Redact** — If the pipeline includes a redactor (text changed), use the output text. Otherwise, generate `[LABEL]` replacements from detected spans.
6. **Respond** — Return spans, redacted text, timing, and optional trace.

## UI schema generation

The platform auto-generates JSON Schema for each pipe config, enriched with UI hints (`ui_widget`, `ui_placeholder`, etc.). This powers dynamic form rendering in the planned playground UI.

```python
from clinical_deid.pipes.ui_schema import pipe_config_json_schema
from clinical_deid.pipes.regex_ner import RegexNerConfig

schema = pipe_config_json_schema(RegexNerConfig)
# Returns JSON Schema dict with ui_* annotations
```

The `/pipelines/pipe-types` endpoint returns these schemas for all registered pipes.
