# Evaluation

Span-level evaluation metrics for measuring PHI detection quality. Currently available as a Python library; an evaluation API endpoint is planned.

## Strict micro F1

The primary metric is **strict micro F1**: a span is a true positive only if it matches a gold span exactly on `(start, end, label)`.

```python
from clinical_deid.eval import strict_micro_f1, span_sets, SpanMicroF1

# Gold and predicted spans as lists of PHISpan
gold_spans = doc.spans       # ground truth
pred_spans = result.spans    # pipeline output

result: SpanMicroF1 = strict_micro_f1(gold_spans, pred_spans)

print(f"Precision: {result.precision:.3f}")
print(f"Recall:    {result.recall:.3f}")
print(f"F1:        {result.f1:.3f}")
print(f"TP: {result.tp}  FP: {result.fp}  FN: {result.fn}")
```

### SpanMicroF1

```python
@dataclass
class SpanMicroF1:
    precision: float
    recall: float
    f1: float
    tp: int    # true positives (exact match on start, end, label)
    fp: int    # false positives (predicted but not in gold)
    fn: int    # false negatives (in gold but not predicted)
```

### span_sets

Convert span lists to sets of `(start, end, label)` tuples for comparison:

```python
gold_set = span_sets(gold_spans)   # set of (start, end, label)
pred_set = span_sets(pred_spans)
```

## Evaluating on a corpus

To evaluate a pipeline across an entire dataset:

```python
from clinical_deid.ingest import load_annotated_corpus
from clinical_deid.eval import strict_micro_f1
from clinical_deid.pipes.registry import load_pipeline

# Load gold-standard corpus
docs = load_annotated_corpus(brat_corpus="data/corpora/physionet/brat")

# Build pipeline
config = {
    "pipes": [
        {"type": "regex_ner", "config": {}},
        {"type": "resolve_spans", "config": {"strategy": "longest_non_overlapping"}},
    ]
}
pipeline = load_pipeline(config)

# Evaluate
total_tp, total_fp, total_fn = 0, 0, 0
for doc in docs:
    from clinical_deid.domain import AnnotatedDocument, Document
    input_doc = AnnotatedDocument(document=doc.document, spans=[])
    pred_doc = pipeline.forward(input_doc)

    result = strict_micro_f1(doc.spans, pred_doc.spans)
    total_tp += result.tp
    total_fp += result.fp
    total_fn += result.fn

precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) else 0
recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) else 0
f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0

print(f"Corpus-level — P: {precision:.3f}  R: {recall:.3f}  F1: {f1:.3f}")
```

## Per-label breakdown

For per-label evaluation, filter spans by label before computing metrics:

```python
for label in ["PATIENT", "DATE", "PHONE", "HOSPITAL"]:
    gold_filtered = [s for s in gold_spans if s.label == label]
    pred_filtered = [s for s in pred_spans if s.label == label]
    result = strict_micro_f1(gold_filtered, pred_filtered)
    print(f"{label:20s}  P={result.precision:.3f}  R={result.recall:.3f}  F1={result.f1:.3f}")
```

## Planned features

The following evaluation capabilities are described in `DESIGN_PLAN.md` and are not yet implemented:

- **Evaluation API** — `POST /eval/run` endpoint for server-side evaluation
- **Multiple match modes** — `exact_boundary`, `partial_overlap`, `token_level` in addition to strict
- **Risk-weighted scoring** — per-label weights reflecting HIPAA severity
- **Evaluation comparison** — side-by-side pipeline comparison with statistical tests
- **Per-document results** — worst-first document sorting for error analysis
