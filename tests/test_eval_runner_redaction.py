"""Tests for the eval runner's redaction awareness and span recovery."""

from __future__ import annotations

from clinical_deid.domain import AnnotatedDocument, Document, PHISpan
from clinical_deid.eval.runner import _recover_spans, evaluate_pipeline
from clinical_deid.pipes.base import Pipe


class MockDetector(Pipe):
    """Detects PHI at fixed positions for testing."""

    def __init__(self, spans: list[PHISpan]):
        self._spans = spans

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        return doc.with_spans(self._spans)


class MockRedactor(Pipe):
    """Replaces PHI with [LABEL] tags, stashing original spans in metadata."""

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        if not doc.spans:
            return doc
        text = doc.document.text
        metadata = {
            **doc.document.metadata,
            "pre_redaction_spans": [s.model_dump() for s in doc.spans],
        }
        # Replace right-to-left
        sorted_spans = sorted(doc.spans, key=lambda s: s.start, reverse=True)
        for s in sorted_spans:
            text = text[: s.start] + f"[{s.label}]" + text[s.end :]
        return AnnotatedDocument(
            document=Document(id=doc.document.id, text=text, metadata=metadata),
            spans=[],
        )


class MockDetectAndRedact(Pipe):
    """Combined detector + redactor for testing."""

    def __init__(self, detector: Pipe, redactor: Pipe):
        self._detector = detector
        self._redactor = redactor

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        detected = self._detector.forward(doc)
        return self._redactor.forward(detected)


def _make_gold_doc(text: str, spans: list[PHISpan]) -> AnnotatedDocument:
    return AnnotatedDocument(
        document=Document(id="test-doc", text=text),
        spans=spans,
    )


def test_recover_spans_from_metadata():
    """_recover_spans extracts pre_redaction_spans from metadata."""
    doc = AnnotatedDocument(
        document=Document(
            id="x",
            text="[PATIENT] called",
            metadata={
                "pre_redaction_spans": [
                    {"start": 0, "end": 10, "label": "PATIENT", "confidence": 0.9, "source": "regex"},
                ]
            },
        ),
        spans=[],
    )
    recovered = _recover_spans(doc)
    assert len(recovered) == 1
    assert recovered[0].label == "PATIENT"
    assert recovered[0].start == 0
    assert recovered[0].end == 10


def test_recover_spans_prefers_existing():
    """If spans are present, metadata is ignored."""
    span = PHISpan(start=0, end=5, label="DATE")
    doc = AnnotatedDocument(
        document=Document(
            id="x",
            text="12345 other",
            metadata={"pre_redaction_spans": [{"start": 6, "end": 11, "label": "OTHER"}]},
        ),
        spans=[span],
    )
    recovered = _recover_spans(doc)
    assert len(recovered) == 1
    assert recovered[0].label == "DATE"


def test_evaluate_detection_only_pipeline():
    """Detection-only pipeline produces no redaction metrics."""
    gold_spans = [PHISpan(start=8, end=18, label="PATIENT")]
    gold_doc = _make_gold_doc("Patient John Smith was here.", gold_spans)

    detector = MockDetector(gold_spans)
    result = evaluate_pipeline(detector, [gold_doc])

    assert result.has_redaction is False
    assert result.redaction is None
    assert result.overall.strict.f1 == 1.0


def test_evaluate_redaction_pipeline():
    """Redaction pipeline produces both detection and redaction metrics."""
    gold_spans = [PHISpan(start=8, end=18, label="PATIENT")]
    gold_doc = _make_gold_doc("Patient John Smith was here.", gold_spans)

    pipeline = MockDetectAndRedact(
        detector=MockDetector(gold_spans),
        redactor=MockRedactor(),
    )
    result = evaluate_pipeline(pipeline, [gold_doc])

    # Detection metrics should work (recovered from metadata)
    assert result.has_redaction is True
    assert result.overall.strict.f1 == 1.0

    # Redaction metrics should show perfect redaction
    assert result.redaction is not None
    assert result.redaction.redaction_recall == 1.0
    assert result.redaction.leaked_phi_count == 0


def test_evaluate_redaction_with_leakage():
    """Pipeline that misses some PHI — leakage is detected."""
    gold_spans = [
        PHISpan(start=8, end=18, label="PATIENT"),
        PHISpan(start=26, end=38, label="PHONE"),
    ]
    gold_doc = _make_gold_doc("Patient John Smith called 555-123-4567.", gold_spans)

    # Detector only finds the name, not the phone
    partial_detector = MockDetector([PHISpan(start=8, end=18, label="PATIENT")])
    pipeline = MockDetectAndRedact(
        detector=partial_detector,
        redactor=MockRedactor(),
    )
    result = evaluate_pipeline(pipeline, [gold_doc])

    assert result.has_redaction is True
    assert result.redaction is not None
    # Phone number should leak
    assert result.redaction.leaked_phi_count == 1
    assert result.redaction.redaction_recall < 1.0

    # Detection metrics should show the miss
    assert result.overall.strict.recall < 1.0
