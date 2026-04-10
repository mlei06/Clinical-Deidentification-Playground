"""Pipe config JSON Schema includes ``ui_*`` hints for dynamic forms."""

from __future__ import annotations

import pytest

from clinical_deid.pipes.blacklist.pipe import BlacklistSpansConfig
from clinical_deid.pipes.combinators import (
    LabelFilterConfig,
    LabelMapperConfig,
    ResolveSpansConfig,
)
from clinical_deid.pipes.regex_ner.pipe import RegexNerConfig
from clinical_deid.pipes.registry import registered_pipes
from clinical_deid.pipes.ui_schema import pipe_config_json_schema
from clinical_deid.pipes.whitelist.pipe import WhitelistConfig


def test_pipe_config_json_schema_matches_model_json_schema() -> None:
    from clinical_deid.pipes.combinators import LabelMapperConfig

    assert pipe_config_json_schema(LabelMapperConfig) == LabelMapperConfig.model_json_schema()


def test_unified_labels_field_has_ui_widget() -> None:
    schema = RegexNerConfig.model_json_schema()
    lm = schema["properties"]["labels"]
    assert lm.get("ui_widget") == "unified_label"
    assert lm.get("ui_group") == "Labels"


def test_resolve_spans_strategy_has_ui_hints() -> None:
    p = ResolveSpansConfig.model_json_schema()["properties"]["strategy"]
    assert p.get("ui_widget") == "described_select"
    assert p.get("ui_group") == "Resolution"
    assert isinstance(p.get("ui_enum_descriptions"), dict)
    assert "exact_dedupe" in p["ui_enum_descriptions"]


def test_label_mapper_mapping_has_ui_hints() -> None:
    p = LabelMapperConfig.model_json_schema()["properties"]["mapping"]
    assert p.get("ui_widget") == "label_mapping"


def test_label_filter_drop_keep_documented() -> None:
    props = LabelFilterConfig.model_json_schema()["properties"]
    assert props["drop"]["ui_group"] == "Filter"
    assert props["keep"]["ui_group"] == "Filter"


@pytest.mark.parametrize(
    "name",
    [
        "regex_ner",
        "whitelist",
        "label_mapper",
        "label_filter",
        "resolve_spans",
        "blacklist",
    ],
)
def test_registered_builtin_configs_expose_ui_metadata(name: str) -> None:
    cfg_cls = registered_pipes()[name]
    schema = cfg_cls.model_json_schema()
    props = schema.get("properties") or {}
    assert props, f"{name} should have properties"
    found = False
    for prop in props.values():
        if isinstance(prop, dict) and any(k.startswith("ui_") for k in prop):
            found = True
            break
    assert found, f"{name} should have at least one ui_* key on a property"


def test_whitelist_nested_schema_has_ui() -> None:
    schema = WhitelistConfig.model_json_schema()
    defs = schema.get("$defs", {})
    assert "WhitelistLabelSettings" in defs
    props = schema["properties"]
    assert props["labels"].get("ui_widget") == "whitelist_label"


def test_blacklist_regex_patterns_conditional_meta() -> None:
    p = BlacklistSpansConfig.model_json_schema()["properties"]["regex_blacklist_patterns"]
    assert p.get("ui_advanced") is True


def test_presidio_anonymizer_operator_params_conditional() -> None:
    from clinical_deid.pipes.presidio_anonymizer.pipe import PresidioAnonymizerConfig

    props = PresidioAnonymizerConfig.model_json_schema()["properties"]
    assert props["masking_char"]["ui_visible_when"]["equals"] == "mask"
    assert props["new_value"]["ui_visible_when"]["equals"] == "replace"
    assert props["key"]["ui_widget"] == "password"
