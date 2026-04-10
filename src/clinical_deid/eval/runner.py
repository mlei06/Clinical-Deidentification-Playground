"""Evaluation runner — batch evaluation with per-label, per-document, and confusion matrix results."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
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


@dataclass
class EvalResult:
    """Aggregate evaluation result across all documents."""

    overall: EvalMetrics
    per_label: dict[str, LabelMetrics]
    risk_weighted_recall: float
    document_results: list[DocumentEvalResult]
    document_count: int
    label_confusion: dict[str, dict[str, int]]


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

    for gold_doc in documents:
        # Run pipeline on clean document (no spans)
        clean = AnnotatedDocument(document=gold_doc.document, spans=[])
        pred_doc = pipeline.forward(clean)

        text = gold_doc.document.text
        pred_spans = list(pred_doc.spans)
        gold_spans = list(gold_doc.spans)

        # Compute metrics
        metrics = compute_metrics(pred_spans, gold_spans, text)
        label_metrics = compute_per_label_metrics(pred_spans, gold_spans, text)

        # False negatives / positives
        fn = _compute_false_negatives(pred_spans, gold_spans)
        fp = _compute_false_positives(pred_spans, gold_spans)
        rwr = risk_weighted_recall(fn, gold_spans, weights)

        doc_results.append(
            DocumentEvalResult(
                document_id=gold_doc.document.id,
                metrics=metrics,
                per_label=label_metrics,
                false_negatives=fn,
                false_positives=fp,
                risk_weighted_recall=rwr,
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

    return EvalResult(
        overall=overall,
        per_label=agg_per_label,
        risk_weighted_recall=total_rwr,
        document_results=doc_results,
        document_count=len(documents),
        label_confusion={k: dict(v) for k, v in total_confusion.items()},
    )
