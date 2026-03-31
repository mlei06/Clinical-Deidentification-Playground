from __future__ import annotations

from dataclasses import dataclass

from clinical_deid.domain import AnnotatedDocument, PHISpan


def span_key(s: PHISpan) -> tuple[int, int, str]:
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
