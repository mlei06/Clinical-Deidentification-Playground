from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from clinical_deid.domain import AnnotatedDocument, EntitySpan


def span_key(s: EntitySpan) -> tuple[int, int, str]:
    return (s.start, s.end, s.label)


def span_sets(doc: AnnotatedDocument) -> set[tuple[int, int, str]]:
    return {span_key(s) for s in doc.spans}


@dataclass(frozen=True)
class SpanMicroF1:
    precision: float
    recall: float
    f1: float
    tp: int
    fp: int
    fn: int


def strict_micro_f1(pred: AnnotatedDocument, gold: AnnotatedDocument) -> SpanMicroF1:
    p = span_sets(pred)
    g = span_sets(gold)
    tp = len(p & g)
    fp = len(p - g)
    fn = len(g - p)
    prec = tp / (tp + fp) if (tp + fp) else 0.0
    rec = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0
    return SpanMicroF1(precision=prec, recall=rec, f1=f1, tp=tp, fp=fp, fn=fn)


# ---------------------------------------------------------------------------
# Per-label evaluation
# ---------------------------------------------------------------------------


def _prf(tp: int, fp: int, fn: int) -> tuple[float, float, float]:
    prec = tp / (tp + fp) if (tp + fp) else 0.0
    rec = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0
    return prec, rec, f1


@dataclass(frozen=True)
class LabelMetrics:
    """Precision / recall / F1 for a single label."""

    label: str
    precision: float
    recall: float
    f1: float
    tp: int
    fp: int
    fn: int


@dataclass(frozen=True)
class EvalReport:
    """Full evaluation report: micro-averaged + per-label breakdown."""

    micro: SpanMicroF1
    per_label: list[LabelMetrics]


def strict_eval_report(
    preds: list[AnnotatedDocument],
    golds: list[AnnotatedDocument],
) -> EvalReport:
    """Compute micro-averaged and per-label strict-match P/R/F1 across a corpus.

    Each ``(pred, gold)`` pair is matched by list position — the caller must
    ensure that ``preds[i]`` corresponds to ``golds[i]``.
    """
    per_label_tp: dict[str, int] = defaultdict(int)
    per_label_fp: dict[str, int] = defaultdict(int)
    per_label_fn: dict[str, int] = defaultdict(int)

    for pred, gold in zip(preds, golds):
        p = span_sets(pred)
        g = span_sets(gold)
        for start, end, label in p & g:
            per_label_tp[label] += 1
        for start, end, label in p - g:
            per_label_fp[label] += 1
        for start, end, label in g - p:
            per_label_fn[label] += 1

    all_labels = sorted(set(per_label_tp) | set(per_label_fp) | set(per_label_fn))
    label_metrics: list[LabelMetrics] = []
    total_tp = total_fp = total_fn = 0

    for label in all_labels:
        tp = per_label_tp[label]
        fp = per_label_fp[label]
        fn = per_label_fn[label]
        prec, rec, f1 = _prf(tp, fp, fn)
        label_metrics.append(
            LabelMetrics(label=label, precision=prec, recall=rec, f1=f1, tp=tp, fp=fp, fn=fn)
        )
        total_tp += tp
        total_fp += fp
        total_fn += fn

    prec, rec, f1 = _prf(total_tp, total_fp, total_fn)
    micro = SpanMicroF1(
        precision=prec, recall=rec, f1=f1, tp=total_tp, fp=total_fp, fn=total_fn
    )

    return EvalReport(micro=micro, per_label=label_metrics)


def collect_low_confidence_spans(
    docs: list[AnnotatedDocument],
    threshold: float = 0.5,
) -> list[tuple[str, EntitySpan, str]]:
    """Return ``(doc_id, span, surface_text)`` for spans with confidence below *threshold*.

    Spans with ``confidence=None`` are excluded (regex-only detectors emit no score).
    """
    results: list[tuple[str, EntitySpan, str]] = []
    for doc in docs:
        text = doc.document.text
        for span in doc.spans:
            if span.confidence is not None and span.confidence < threshold:
                surface = text[span.start : span.end]
                results.append((doc.document.id, span, surface))
    return results
