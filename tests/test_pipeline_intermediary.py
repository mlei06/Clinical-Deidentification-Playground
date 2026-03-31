"""Pipeline intermediate tracing (store_intermediary / store_if_intermediary)."""

from __future__ import annotations

import pytest

from clinical_deid.domain import AnnotatedDocument, Document
from clinical_deid.pipes.combinators import ParallelDetectors
from clinical_deid.pipes.regex_ner import RegexNerConfig, RegexNerPipe
from clinical_deid.pipes.registry import (
    dump_pipeline,
    load_pipeline,
    pipeline_config_requests_intermediary,
    registered_pipes,
)
from clinical_deid.pipes.whitelist import WhitelistConfig, WhitelistLabelConfig, WhitelistPipe


class _MutatesTextPipe:
    """Test pipe that changes doc.document.text (redactor-like)."""

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        return doc.model_copy(
            update={
                "document": doc.document.model_copy(
                    update={"text": doc.document.text + "!"},
                ),
                "spans": [],
            }
        )


def _doc(text: str) -> AnnotatedDocument:
    return AnnotatedDocument(document=Document(id="d", text=text), spans=[])


def test_pipeline_config_requests_intermediary_detects_flags() -> None:
    assert not pipeline_config_requests_intermediary({"pipes": [{"type": "regex_ner"}]})
    assert pipeline_config_requests_intermediary(
        {"pipes": [{"type": "regex_ner", "store_if_intermediary": True}]}
    )
    assert pipeline_config_requests_intermediary({"store_intermediary": True, "pipes": []})
    assert pipeline_config_requests_intermediary(
        {
            "pipes": [
                {
                    "type": "parallel",
                    "detectors": [{"type": "regex_ner", "store_if_intermediary": True}],
                }
            ]
        }
    )


def test_forward_with_trace_parallel_branches_before_merge() -> None:
    cfg = {
        "store_intermediary": True,
        "pipes": [
            {
                "type": "parallel",
                "strategy": "union",
                "detectors": [
                    {"type": "regex_ner"},
                    {
                        "type": "whitelist",
                        "config": {
                            "per_label": {
                                "HOSPITAL": WhitelistLabelConfig(
                                    terms=["Zed Clinic"],
                                    include_builtin_terms=False,
                                ),
                            },
                        },
                    },
                ],
            },
        ],
    }
    p = load_pipeline(cfg)
    doc = _doc("Contact a@b.co at Zed Clinic.")
    run = p.forward_with_trace(doc)
    stages = {f.stage for f in run.trace}
    assert "parallel_pre_merge" in stages
    assert "parallel_post_merge" in stages
    paths = [f.path for f in run.trace]
    assert any("parallel/branch_0" in x for x in paths)
    assert any("parallel/branch_1" in x for x in paths)
    assert any("post_merge" in x for x in paths)


def test_store_if_intermediary_per_step_only() -> None:
    cfg = {
        "pipes": [
            {"type": "regex_ner", "store_if_intermediary": True},
            {"type": "regex_ner", "config": RegexNerConfig(include_builtin_regex=False)},
        ]
    }
    p = load_pipeline(cfg)
    run = p.forward_with_trace(_doc("x@y.co"))
    assert len(run.trace) == 1
    assert run.trace[0].path == "step_0"
    assert run.trace[0].stage == "sequential"


def test_dump_load_roundtrip_retains_intermediary_flags() -> None:
    cfg = {
        "store_intermediary": True,
        "pipes": [
            {"type": "regex_ner", "store_if_intermediary": True},
            {
                "type": "parallel",
                "store_if_intermediary": False,
                "detectors": [{"type": "regex_ner"}],
            },
        ],
    }
    p0 = load_pipeline(cfg)
    p1 = load_pipeline(dump_pipeline(p0))
    assert p1.store_intermediary
    assert p1.step_store_if_intermediary == (True, False)
    para = p1.pipes[1]
    assert isinstance(para, ParallelDetectors)
    assert not para.store_if_intermediary


def test_parallel_legacy_detectors_constructor() -> None:
    """Backward-compatible detectors= keyword."""
    p = ParallelDetectors(
        detectors=[
            RegexNerPipe(RegexNerConfig(include_builtin_regex=False)),
            WhitelistPipe(WhitelistConfig(include_builtin_term_files=False)),
        ],
        strategy="union",
    )
    out = p.forward(_doc("a@b.co"))
    assert isinstance(out.spans, list)


def test_parallel_rejects_text_mutating_branch() -> None:
    p = ParallelDetectors(
        detectors=[
            RegexNerPipe(RegexNerConfig(include_builtin_regex=False)),
            _MutatesTextPipe(),
        ],
        strategy="union",
    )  # type: ignore[arg-type]
    doc = _doc("hello world")
    try:
        p.forward(doc)
        assert False, "Expected ValueError"
    except ValueError as exc:
        assert "text-preserving" in str(exc)


def test_parallel_rejects_redactor_branch_load_time() -> None:
    if "presidio_anonymizer" not in registered_pipes():
        pytest.skip("presidio_anonymizer not registered (missing presidio extras)")

    cfg = {
        "pipes": [
            {
                "type": "parallel",
                "strategy": "union",
                "detectors": [
                    {
                        "type": "presidio_anonymizer",
                        "config": {"operator": "keep"},
                    },
                    {"type": "regex_ner"},
                ],
            }
        ]
    }

    with pytest.raises(ValueError, match="ParallelDetectors only supports text-preserving"):
        load_pipeline(cfg)
