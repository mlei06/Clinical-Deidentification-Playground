"""Tests for resolve_spans pipe and shared span_merge logic."""

from __future__ import annotations

from clinical_deid.domain import AnnotatedDocument, Document, PHISpan
from clinical_deid.pipes.combinators import Pipeline, ResolveSpans, ResolveSpansConfig
from clinical_deid.pipes.regex_ner import RegexNerConfig, RegexNerPipe
from clinical_deid.pipes.registry import load_pipeline
from clinical_deid.pipes.whitelist import WhitelistConfig, WhitelistPipe


def _doc(text: str, spans: list[PHISpan]) -> AnnotatedDocument:
    return AnnotatedDocument(document=Document(id="d", text=text), spans=spans)


def test_resolve_spans_longest_non_overlapping_single_group() -> None:
    text = "abcdefghijkl"
    spans = [
        PHISpan(start=0, end=3, label="A"),
        PHISpan(start=2, end=8, label="B"),
    ]
    pipe = ResolveSpans(ResolveSpansConfig(strategy="longest_non_overlapping"))
    out = pipe.forward(_doc(text, spans)).spans
    assert len(out) == 1
    assert out[0].label == "B"
    assert out[0].start == 2 and out[0].end == 8


def test_resolve_spans_exact_dedupe() -> None:
    spans = [
        PHISpan(start=0, end=3, label="X"),
        PHISpan(start=0, end=3, label="X"),
    ]
    pipe = ResolveSpans(ResolveSpansConfig(strategy="exact_dedupe"))
    out = pipe.forward(_doc("abc", spans)).spans
    assert len(out) == 1


def test_chained_detectors_then_resolve() -> None:
    """Chained detectors accumulate spans; resolve_spans dedupes them."""
    cfg = {
        "pipes": [
            {"type": "regex_ner"},
            {
                "type": "whitelist",
                "config": {"load_all_dictionaries": False},
            },
            {"type": "resolve_spans", "config": {"strategy": "exact_dedupe"}},
        ]
    }
    p = load_pipeline(cfg)
    doc = AnnotatedDocument(document=Document(id="x", text="x@y.co"), spans=[])
    out = p.forward(doc)
    assert isinstance(out.spans, list)


def test_regex_then_resolve_longest() -> None:
    pipe = Pipeline(pipes=[
        RegexNerPipe(RegexNerConfig()),
        WhitelistPipe(WhitelistConfig(load_all_dictionaries=False)),
    ])
    doc = AnnotatedDocument(document=Document(id="d", text="a@b.co extra"), spans=[])
    doc = pipe.forward(doc)
    resolver = ResolveSpans(ResolveSpansConfig(strategy="longest_non_overlapping"))
    doc2 = resolver.forward(doc)
    assert all(isinstance(s, PHISpan) for s in doc2.spans)
