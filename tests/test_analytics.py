from __future__ import annotations

from clinical_deid.analytics.stats import compute_dataset_analytics
from clinical_deid.domain import AnnotatedDocument, Document, PHISpan


def test_analytics_two_docs_overlap_and_cooc() -> None:
    a = AnnotatedDocument(
        document=Document(id="1", text="Hello world patient"),
        spans=[
            PHISpan(start=0, end=5, label="X"),
            PHISpan(start=3, end=8, label="Y"),  # overlaps first
        ],
    )
    b = AnnotatedDocument(
        document=Document(id="2", text="foo"),
        spans=[PHISpan(start=0, end=3, label="X"),
               PHISpan(start=0, end=3, label="Z")],  # same span two labels - overlap
    )
    stats = compute_dataset_analytics([a, b])
    assert stats.document_count == 2
    assert stats.total_spans == 4
    assert stats.documents_by_span_count["2"] == 2  # each doc has 2 spans
    assert stats.label_counts["X"] == 2
    assert stats.documents_with_overlapping_spans >= 1
    assert stats.overlapping_span_pairs >= 1
    assert "X|Y" in stats.label_cooccurrence or "X|Z" in stats.label_cooccurrence


def test_analytics_empty() -> None:
    s = compute_dataset_analytics([])
    assert s.document_count == 0
    assert s.total_spans == 0
    assert s.documents_by_span_count == {}


def test_documents_by_span_count_mixed() -> None:
    docs = [
        AnnotatedDocument(document=Document(id="a", text="x"), spans=[]),
        AnnotatedDocument(
            document=Document(id="b", text="y"),
            spans=[PHISpan(start=0, end=1, label="L")],
        ),
        AnnotatedDocument(
            document=Document(id="c", text="z z"),
            spans=[
                PHISpan(start=0, end=1, label="L"),
                PHISpan(start=2, end=3, label="L"),
            ],
        ),
    ]
    s = compute_dataset_analytics(docs)
    assert s.documents_by_span_count["0"] == 1
    assert s.documents_by_span_count["1"] == 1
    assert s.documents_by_span_count["2"] == 1
