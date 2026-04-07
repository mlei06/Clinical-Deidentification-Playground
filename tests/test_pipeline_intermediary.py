"""Pipeline intermediate tracing (store_intermediary / store_if_intermediary)."""

from __future__ import annotations

import warnings

from clinical_deid.domain import AnnotatedDocument, Document
from clinical_deid.pipes.regex_ner import RegexNerConfig, RegexNerPipe
from clinical_deid.pipes.registry import (
    dump_pipeline,
    load_pipeline,
    pipeline_config_requests_intermediary,
)
from clinical_deid.pipes.whitelist import WhitelistConfig, WhitelistLabelConfig, WhitelistPipe


def _doc(text: str) -> AnnotatedDocument:
    return AnnotatedDocument(document=Document(id="d", text=text), spans=[])


def test_pipeline_config_requests_intermediary_detects_flags() -> None:
    assert not pipeline_config_requests_intermediary({"pipes": [{"type": "regex_ner"}]})
    assert pipeline_config_requests_intermediary(
        {"pipes": [{"type": "regex_ner", "store_if_intermediary": True}]}
    )
    assert pipeline_config_requests_intermediary({"store_intermediary": True, "pipes": []})


def test_forward_with_trace_sequential_detectors() -> None:
    cfg = {
        "store_intermediary": True,
        "pipes": [
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
    }
    p = load_pipeline(cfg)
    doc = _doc("Contact a@b.co at Zed Clinic.")
    run = p.forward_with_trace(doc)
    stages = {f.stage for f in run.trace}
    assert "sequential" in stages
    assert len(run.trace) == 2  # one frame per detector


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
            {"type": "whitelist"},
        ],
    }
    p0 = load_pipeline(cfg)
    p1 = load_pipeline(dump_pipeline(p0))
    assert p1.store_intermediary
    assert p1.step_store_if_intermediary == (True, False)


def test_backward_compat_parallel_flattens_to_sequential() -> None:
    """Legacy 'type: parallel' JSON is migrated to sequential detectors."""
    cfg = {
        "pipes": [
            {
                "type": "parallel",
                "strategy": "union",
                "detectors": [
                    {"type": "regex_ner"},
                    {"type": "whitelist", "config": {"include_builtin_term_files": False}},
                ],
            }
        ]
    }
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        p = load_pipeline(cfg)
        assert any("deprecated" in str(x.message).lower() for x in w)
    # Parallel block should be flattened into 2 sequential pipes
    assert len(p.pipes) == 2
    out = p.forward(_doc("Call 555-123-4567."))
    assert len(out.spans) >= 1
