"""Whitelist: phrase / dictionary PHI detection (bundled ``defaults/<LABEL>.txt``)."""

from __future__ import annotations

import re
from functools import lru_cache
from importlib import resources
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from clinical_deid.domain import AnnotatedDocument, PHISpan
from clinical_deid.pipes.base import ConfigurablePipe
from clinical_deid.pipes.detector_label_mapping import (
    apply_detector_label_mapping,
    detector_label_mapping_field,
    effective_detector_labels,
)
from clinical_deid.pipes.ui_schema import field_ui
from clinical_deid.pipes.whitelist.lists import parse_list_file, term_to_list_pattern


class WhitelistLabelConfig(BaseModel):
    """Per-label whitelist (phrases to emit as spans)."""

    terms: list[str] = Field(
        default_factory=list,
        json_schema_extra=field_ui(
            ui_group="Phrases",
            ui_order=1,
            ui_widget="multiselect",
            ui_help="Phrases to match as spans for this label.",
        ),
    )
    include_builtin_terms: bool = Field(
        default=True,
        json_schema_extra=field_ui(
            ui_group="Phrases",
            ui_order=2,
            ui_widget="switch",
            ui_help="Include packaged defaults/<LABEL>.txt when present.",
        ),
    )


class WhitelistConfig(BaseModel):
    """Configuration for :class:`WhitelistPipe`."""

    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "Per-label phrase lists (whitelist gazetteer). "
                "Compose with ``regex_ner`` in ``parallel`` for combined coverage."
            )
        }
    )

    source_name: str = Field(
        default="whitelist",
        json_schema_extra=field_ui(
            ui_group="General",
            ui_order=1,
            ui_widget="text",
            ui_advanced=True,
        ),
    )

    per_label: dict[str, WhitelistLabelConfig] = Field(
        default_factory=dict,
        json_schema_extra=field_ui(
            ui_group="Phrases",
            ui_order=2,
            ui_widget="nested_dict",
        ),
    )

    include_builtin_term_files: bool = Field(
        default=True,
        json_schema_extra=field_ui(
            ui_group="Builtin lists",
            ui_order=3,
            ui_widget="switch",
            ui_options_source="bundled_whitelist_labels",
        ),
    )
    builtin_terms_dir: str | None = Field(
        default=None,
        json_schema_extra=field_ui(
            ui_group="Builtin lists",
            ui_order=4,
            ui_widget="text",
            ui_placeholder="/path/to/dir",
            ui_help="Optional directory of <LABEL>.txt files (same format as packaged defaults).",
            ui_advanced=True,
        ),
    )

    label_mapping: dict[str, str | None] = detector_label_mapping_field()


@lru_cache
def _builtin_list_dir_files() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    try:
        root = resources.files("clinical_deid.pipes.whitelist.defaults")
    except ModuleNotFoundError:
        return out
    try:
        if not root.is_dir():
            return out
        for p in root.iterdir():
            if p.name.endswith(".txt"):
                label = Path(p.name).stem.upper()
                text = p.read_text(encoding="utf-8")
                out[label] = parse_list_file(text, filename=p.name)
    except (OSError, TypeError):
        pass
    return out


def bundled_whitelist_label_names() -> list[str]:
    """Labels with packaged ``defaults/<LABEL>.txt`` files."""
    return sorted(_builtin_list_dir_files().keys())


def _filesystem_builtin_lists(custom_dir: str | None) -> dict[str, list[str]]:
    if not custom_dir:
        return {}
    root = Path(custom_dir).expanduser()
    if not root.is_dir():
        return {}
    out: dict[str, list[str]] = {}
    for path in sorted(root.glob("*.txt")):
        label = path.stem.upper()
        try:
            out[label] = parse_list_file(path.read_text(encoding="utf-8"), filename=path.name)
        except OSError:
            continue
    return out


def _merged_builtin_terms(
    include_bundled: bool,
    include_fs: str | None,
) -> dict[str, list[str]]:
    merged: dict[str, list[str]] = {}
    if include_bundled:
        for label, terms in _builtin_list_dir_files().items():
            merged.setdefault(label, []).extend(terms)
    for label, terms in _filesystem_builtin_lists(include_fs).items():
        merged.setdefault(label, []).extend(terms)
    for label in list(merged.keys()):
        seen: set[str] = set()
        deduped: list[str] = []
        for t in merged[label]:
            key = t.casefold()
            if key not in seen:
                seen.add(key)
                deduped.append(t)
        merged[label] = deduped
    return merged


class _ResolvedList:
    __slots__ = ("label", "terms")

    def __init__(self, label: str, terms: list[str]) -> None:
        self.label = label
        self.terms = terms


def _resolve_list_labels(config: WhitelistConfig) -> list[_ResolvedList]:
    builtin_terms = _merged_builtin_terms(
        config.include_builtin_term_files,
        config.builtin_terms_dir,
    )

    label_keys: set[str] = set(builtin_terms.keys()) | set(config.per_label.keys())

    resolved: list[_ResolvedList] = []
    for label in sorted(label_keys):
        sub = config.per_label.get(label, WhitelistLabelConfig())
        terms: list[str] = []
        if sub.include_builtin_terms and label in builtin_terms:
            terms.extend(builtin_terms[label])
        terms.extend(sub.terms)

        seen: set[str] = set()
        uniq: list[str] = []
        for t in terms:
            k = t.casefold()
            if t.strip() and k not in seen:
                seen.add(k)
                uniq.append(t.strip())

        if not uniq:
            continue
        resolved.append(_ResolvedList(label, uniq))
    return resolved


class WhitelistPipe(ConfigurablePipe):
    """Detector: whitelist phrase matching only."""

    def __init__(self, config: WhitelistConfig | None = None) -> None:
        self._config = config or WhitelistConfig()
        self._resolved = _resolve_list_labels(self._config)
        self._list_patterns: list[tuple[str, re.Pattern[str]]] = []
        for r in self._resolved:
            for term in r.terms:
                self._list_patterns.append((r.label, term_to_list_pattern(term)))

    @property
    def base_labels(self) -> set[str]:
        return {r.label for r in self._resolved}

    @property
    def label_mapping(self) -> dict[str, str | None]:
        return dict(self._config.label_mapping)

    @property
    def labels(self) -> set[str]:
        return effective_detector_labels(self.base_labels, self._config.label_mapping)

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        text = doc.document.text
        found: list[PHISpan] = []
        seen: set[tuple[int, int, str]] = set()
        for label, rx in self._list_patterns:
            for m in rx.finditer(text):
                key = (m.start(), m.end(), label)
                if key not in seen:
                    seen.add(key)
                    found.append(
                        PHISpan(
                            start=m.start(),
                            end=m.end(),
                            label=label,
                            confidence=None,
                            source=self._config.source_name,
                        )
                    )
        found.sort(key=lambda s: (s.start, s.end, s.label))
        found = apply_detector_label_mapping(found, self._config.label_mapping)
        return doc.with_spans(found)
