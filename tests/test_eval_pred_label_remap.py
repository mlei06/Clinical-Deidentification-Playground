"""Tests for request-scoped ``pred_label_remap`` in :func:`evaluate_pipeline`."""

from __future__ import annotations

from clinical_deid.domain import AnnotatedDocument, Document, EntitySpan
from clinical_deid.eval.runner import evaluate_pipeline
from clinical_deid.pipes.base import Pipe
from clinical_deid.risk import CLINICAL_PHI_RISK


class _PhonePred(Pipe):
    """Emits TELEPHONE where gold is PHONE (same span)."""

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        return doc.with_spans([EntitySpan(start=0, end=5, label="TELEPHONE")])


def test_evaluate_pipeline_pred_label_remap_aligns_gold() -> None:
    text = "call me"
    gold = AnnotatedDocument(
        document=Document(id="d1", text=text),
        spans=[EntitySpan(start=0, end=5, label="PHONE")],
    )
    no_remap = evaluate_pipeline(_PhonePred(), [gold], risk_profile=CLINICAL_PHI_RISK)
    with_remap = evaluate_pipeline(
        _PhonePred(),
        [gold],
        risk_profile=CLINICAL_PHI_RISK,
        pred_label_remap={"TELEPHONE": "PHONE"},
    )
    assert no_remap.overall.strict.tp < with_remap.overall.strict.tp
    assert with_remap.overall.strict.tp == 1
    assert with_remap.overall.strict.fp == 0
    assert with_remap.overall.strict.fn == 0
