"""Evaluation runner — batch evaluation with per-label, per-document, and confusion matrix results.

Supports two evaluation modes:

- **Detection**: compares predicted spans against gold spans (standard NER evaluation).
- **Redaction**: checks whether gold PHI strings still appear in the pipeline's output text
  (relevant when the pipeline includes a redactor/surrogate that consumes spans).

The runner auto-detects which mode applies based on whether the pipeline's output text
differs from the input and/or spans are empty with ``pre_redaction_spans`` in metadata.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from clinical_deid.domain import AnnotatedDocument, PHISpan
from clinical_deid.eval.matching import (
    EvalMetrics,
    LabelMetrics,
    MatchResult,
    compute_metrics,
    compute_per_label_metrics,
    make_match_result,
)
from clinical_deid.eval.redaction import RedactionMetrics, compute_redaction_metrics
from clinical_deid.eval.risk import DEFAULT_RISK_WEIGHTS, risk_weighted_recall
from clinical_deid.pipes.base import Pipe


# ---------------------------------------------------------------------------
# Result dataclasses
# ---------------------------------------------------------------------------


@dataclass
class DocumentEvalResult:
    """Evaluation result for a single document."""

    document_id: str
    metrics: EvalMetrics
    per_label: list[LabelMetrics]
    false_negatives: list[PHISpan]
    false_positives: list[PHISpan]
    risk_weighted_recall: float
    redaction: RedactionMetrics | None = None


@dataclass
class EvalResult:
    """Aggregate evaluation result across all documents."""

    overall: EvalMetrics
    per_label: dict[str, LabelMetrics]
    risk_weighted_recall: float
    document_results: list[DocumentEvalResult]
    document_count: int
    label_confusion: dict[str, dict[str, int]]
    redaction: RedactionMetrics | None = None
    has_redaction: bool = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _compute_false_negatives(
    pred_spans: list[PHISpan], gold_spans: list[PHISpan]
) -> list[PHISpan]:
    """Gold spans not matched (exact start, end, label) by any prediction."""
    pred_set = {(s.start, s.end, s.label) for s in pred_spans}
    return [s for s in gold_spans if (s.start, s.end, s.label) not in pred_set]


def _compute_false_positives(
    pred_spans: list[PHISpan], gold_spans: list[PHISpan]
) -> list[PHISpan]:
    """Predicted spans not matched by any gold span."""
    gold_set = {(s.start, s.end, s.label) for s in gold_spans}
    return [s for s in pred_spans if (s.start, s.end, s.label) not in gold_set]


def _build_confusion_matrix(
    pred_spans: list[PHISpan], gold_spans: list[PHISpan]
) -> dict[str, dict[str, int]]:
    """Build label confusion matrix from overlapping pred/gold spans.

    Returns ``{gold_label: {pred_label: count}}``.
    """
    confusion: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for gs in gold_spans:
        matched = False
        for ps in pred_spans:
            # Check for overlap
            if ps.start < gs.end and gs.start < ps.end:
                confusion[gs.label][ps.label] += 1
                matched = True
        if not matched:
            confusion[gs.label]["<MISSED>"] += 1

    return {k: dict(v) for k, v in confusion.items()}


def _aggregate_match_results(results: list[MatchResult]) -> MatchResult:
    """Sum TP/FP/FN across results and recompute P/R/F1."""
    tp = sum(r.tp for r in results)
    fp = sum(r.fp for r in results)
    fn = sum(r.fn for r in results)
    partial = sum(r.partial for r in results)
    return make_match_result(tp, fp, fn, partial)


def _recover_spans(pred_doc: AnnotatedDocument) -> list[PHISpan]:
    """Recover detection spans from a redactor pipeline's output.

    Redactor pipes (SurrogatePipe, PresidioAnonymizerPipe) set ``spans=[]``
    because character offsets are invalid in the transformed text, but
    SurrogatePipe stashes the original spans in ``metadata["pre_redaction_spans"]``.
    """
    if pred_doc.spans:
        return list(pred_doc.spans)

    pre = pred_doc.document.metadata.get("pre_redaction_spans")
    if pre and isinstance(pre, list):
        recovered: list[PHISpan] = []
        for s in pre:
            try:
                recovered.append(PHISpan(
                    start=s["start"],
                    end=s["end"],
                    label=s["label"],
                    confidence=s.get("confidence"),
                    source=s.get("source"),
                ))
            except (KeyError, ValueError):
                continue
        return recovered

    return []


def _aggregate_redaction_metrics(doc_metrics: list[RedactionMetrics]) -> RedactionMetrics:
    """Aggregate per-document redaction metrics into a corpus-level summary."""
    from collections import Counter

    total_gold = sum(m.gold_phi_count for m in doc_metrics)
    total_leaked = sum(m.leaked_phi_count for m in doc_metrics)
    total_orig_len = sum(m.original_length for m in doc_metrics)
    total_redacted_len = sum(m.redacted_length for m in doc_metrics)
    total_over_redaction = sum(m.over_redaction_chars for m in doc_metrics)

    leakage_rate = total_leaked / total_gold if total_gold > 0 else 0.0

    # Aggregate per-label
    gold_by_label: Counter[str] = Counter()
    leaked_by_label: Counter[str] = Counter()
    for m in doc_metrics:
        for ll in m.per_label:
            gold_by_label[ll.label] += ll.gold_count
            leaked_by_label[ll.label] += ll.leaked_count

    from clinical_deid.eval.redaction import LabelLeakage

    per_label = []
    for label in sorted(gold_by_label):
        gc = gold_by_label[label]
        lc = leaked_by_label.get(label, 0)
        per_label.append(LabelLeakage(
            label=label,
            gold_count=gc,
            leaked_count=lc,
            leakage_rate=round(lc / gc, 6) if gc > 0 else 0.0,
        ))

    # Collect all leaked spans across docs
    all_leaked = []
    for m in doc_metrics:
        all_leaked.extend(m.leaked_spans)

    return RedactionMetrics(
        gold_phi_count=total_gold,
        leaked_phi_count=total_leaked,
        leakage_rate=round(leakage_rate, 6),
        redaction_recall=round(1.0 - leakage_rate, 6),
        per_label=per_label,
        leaked_spans=all_leaked,
        over_redaction_chars=total_over_redaction,
        original_length=total_orig_len,
        redacted_length=total_redacted_len,
    )


# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------


def evaluate_pipeline(
    pipeline: Pipe,
    documents: list[AnnotatedDocument],
    risk_weights: dict[str, float] | None = None,
) -> EvalResult:
    """Run pipeline on each doc, compute all metrics, sort docs by worst performance.

    Each document in *documents* is treated as a gold-standard reference.
    The pipeline is run on a clean copy (no spans), and results are compared.

    If the pipeline's output text differs from the input (indicating redaction),
    redaction metrics are also computed.
    """
    weights = risk_weights or DEFAULT_RISK_WEIGHTS
    doc_results: list[DocumentEvalResult] = []
    all_fn: list[PHISpan] = []
    all_gold: list[PHISpan] = []

    # Per-mode accumulators
    strict_results: list[MatchResult] = []
    exact_boundary_results: list[MatchResult] = []
    partial_results: list[MatchResult] = []
    token_results: list[MatchResult] = []

    # Per-label accumulators (label → list of LabelMetrics)
    per_label_acc: dict[str, list[LabelMetrics]] = defaultdict(list)

    # Confusion matrix accumulator
    total_confusion: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    # Redaction metrics accumulators
    doc_redaction_metrics: list[RedactionMetrics] = []
    has_redaction = False

    for gold_doc in documents:
        # Run pipeline on clean document (no spans)
        clean = AnnotatedDocument(document=gold_doc.document, spans=[])
        pred_doc = pipeline.forward(clean)

        text = gold_doc.document.text
        gold_spans = list(gold_doc.spans)

        # Recover spans (handles both normal output and redactor metadata)
        pred_spans = _recover_spans(pred_doc)

        # Detect redaction: output text differs from input
        is_redacted = pred_doc.document.text != text

        # Compute detection metrics
        metrics = compute_metrics(pred_spans, gold_spans, text)
        label_metrics = compute_per_label_metrics(pred_spans, gold_spans, text)

        # False negatives / positives
        fn = _compute_false_negatives(pred_spans, gold_spans)
        fp = _compute_false_positives(pred_spans, gold_spans)
        rwr = risk_weighted_recall(fn, gold_spans, weights)

        # Compute redaction metrics if text was transformed
        doc_redaction: RedactionMetrics | None = None
        if is_redacted:
            has_redaction = True
            gold_span_dicts = [
                {"start": s.start, "end": s.end, "label": s.label}
                for s in gold_spans
            ]
            doc_redaction = compute_redaction_metrics(
                original_text=text,
                redacted_text=pred_doc.document.text,
                gold_spans=gold_span_dicts,
            )
            doc_redaction_metrics.append(doc_redaction)

        doc_results.append(
            DocumentEvalResult(
                document_id=gold_doc.document.id,
                metrics=metrics,
                per_label=label_metrics,
                false_negatives=fn,
                false_positives=fp,
                risk_weighted_recall=rwr,
                redaction=doc_redaction,
            )
        )

        # Accumulate
        strict_results.append(metrics.strict)
        exact_boundary_results.append(metrics.exact_boundary)
        partial_results.append(metrics.partial_overlap)
        token_results.append(metrics.token_level)
        all_fn.extend(fn)
        all_gold.extend(gold_spans)

        for lm in label_metrics:
            per_label_acc[lm.label].append(lm)

        # Confusion
        doc_confusion = _build_confusion_matrix(pred_spans, gold_spans)
        for gl, pred_map in doc_confusion.items():
            for pl, count in pred_map.items():
                total_confusion[gl][pl] += count

    # Sort documents by worst strict F1 first
    doc_results.sort(key=lambda d: d.metrics.strict.f1)

    # Aggregate overall metrics
    overall = EvalMetrics(
        strict=_aggregate_match_results(strict_results),
        exact_boundary=_aggregate_match_results(exact_boundary_results),
        partial_overlap=_aggregate_match_results(partial_results),
        token_level=_aggregate_match_results(token_results),
    )

    # Aggregate per-label
    agg_per_label: dict[str, LabelMetrics] = {}
    for label, lm_list in sorted(per_label_acc.items()):
        strict_agg = _aggregate_match_results([lm.strict for lm in lm_list])
        partial_agg = _aggregate_match_results([lm.partial_overlap for lm in lm_list])
        token_agg = _aggregate_match_results([lm.token_level for lm in lm_list])
        support = sum(lm.support for lm in lm_list)
        agg_per_label[label] = LabelMetrics(
            label=label,
            strict=strict_agg,
            partial_overlap=partial_agg,
            token_level=token_agg,
            support=support,
        )

    total_rwr = risk_weighted_recall(all_fn, all_gold, weights)

    # Aggregate redaction metrics
    agg_redaction: RedactionMetrics | None = None
    if doc_redaction_metrics:
        agg_redaction = _aggregate_redaction_metrics(doc_redaction_metrics)

    return EvalResult(
        overall=overall,
        per_label=agg_per_label,
        risk_weighted_recall=total_rwr,
        document_results=doc_results,
        document_count=len(documents),
        label_confusion={k: dict(v) for k, v in total_confusion.items()},
        redaction=agg_redaction,
        has_redaction=has_redaction,
    )
