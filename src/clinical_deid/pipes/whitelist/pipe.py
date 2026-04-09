"""Whitelist: phrase / dictionary PHI detection via inline terms and dictionary store."""

from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field

from clinical_deid.domain import AnnotatedDocument, PHISpan
from clinical_deid.pipes.base import ConfigurablePipe
from clinical_deid.pipes.detector_label_mapping import (
    accumulate_spans,
    apply_detector_label_mapping,
    detector_label_mapping_field,
    effective_detector_labels,
)
from clinical_deid.pipes.ui_schema import field_ui
from clinical_deid.pipes.whitelist.lists import term_to_list_pattern


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
    dictionaries: list[str] = Field(
        default_factory=list,
        description="Names of dictionaries in ``data/dictionaries/whitelist/<LABEL>/`` to load.",
        json_schema_extra=field_ui(
            ui_group="Phrases",
            ui_order=2,
            ui_widget="multiselect",
            ui_help="Dictionary names from the dictionaries store for this label.",
        ),
    )


class WhitelistConfig(BaseModel):
    """Configuration for :class:`WhitelistPipe`."""

    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "Per-label phrase lists (whitelist gazetteer). "
                "Chain with ``regex_ner`` for combined coverage."
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

    load_all_dictionaries: bool = Field(
        default=True,
        description=(
            "Auto-discover and load all dictionaries from ``data/dictionaries/whitelist/``."
            " Each subdirectory becomes a label. Set to false to load only explicitly"
            " named dictionaries via per_label."
        ),
        json_schema_extra=field_ui(
            ui_group="Dictionaries",
            ui_order=3,
            ui_widget="switch",
            ui_help="Auto-load all whitelist dictionaries from the store.",
        ),
    )

    label_mapping: dict[str, str | None] = detector_label_mapping_field()

    skip_overlapping: bool = Field(
        default=False,
        description="Drop new spans that overlap any existing span in the document.",
        json_schema_extra=field_ui(
            ui_group="General",
            ui_order=99,
            ui_widget="switch",
            ui_advanced=True,
        ),
    )


class _ResolvedList:
    __slots__ = ("label", "terms")

    def __init__(self, label: str, terms: list[str]) -> None:
        self.label = label
        self.terms = terms


def _get_dictionary_store():
    """Lazy import to avoid circular deps and allow tests to override settings."""
    from clinical_deid.config import get_settings
    from clinical_deid.dictionary_store import DictionaryStore

    return DictionaryStore(get_settings().dictionaries_dir)


def _auto_discover_whitelist_terms() -> dict[str, list[str]]:
    """Load all whitelist dictionaries from the store, grouped by label."""
    try:
        store = _get_dictionary_store()
        dicts = store.list_dictionaries(kind="whitelist")
    except Exception:
        return {}
    terms_by_label: dict[str, list[str]] = {}
    for d in dicts:
        if d.label is None:
            continue
        try:
            terms = store.get_terms("whitelist", d.name, label=d.label)
            terms_by_label.setdefault(d.label, []).extend(terms)
        except FileNotFoundError:
            continue
    return terms_by_label


def _load_named_dictionaries(label: str, names: list[str]) -> list[str]:
    """Load terms from explicitly named dictionaries for a label."""
    if not names:
        return []
    try:
        store = _get_dictionary_store()
        return store.load_whitelist_terms(names, label)
    except Exception:
        return []


def _resolve_list_labels(config: WhitelistConfig) -> list[_ResolvedList]:
    # Auto-discover all dictionaries in the store
    auto_terms: dict[str, list[str]] = {}
    if config.load_all_dictionaries:
        auto_terms = _auto_discover_whitelist_terms()

    label_keys: set[str] = set(auto_terms.keys()) | set(config.per_label.keys())

    resolved: list[_ResolvedList] = []
    for label in sorted(label_keys):
        sub = config.per_label.get(label, WhitelistLabelConfig())
        terms: list[str] = []

        # Auto-discovered terms (from all dictionaries for this label)
        if config.load_all_dictionaries and label in auto_terms:
            terms.extend(auto_terms[label])

        # Explicitly named dictionaries (even if load_all_dictionaries is off)
        if not config.load_all_dictionaries:
            terms.extend(_load_named_dictionaries(label, sub.dictionaries))

        # Inline terms
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
        return accumulate_spans(doc, found, skip_overlapping=self._config.skip_overlapping)
