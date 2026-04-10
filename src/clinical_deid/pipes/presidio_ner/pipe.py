from __future__ import annotations

from typing import Any, Literal

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


# Presidio entity → our PHI label mapping
DEFAULT_ENTITY_MAP: dict[str, str] = {
    "PERSON": "NAME",
    "DATE_TIME": "DATE",
    "PHONE_NUMBER": "PHONE",
    "EMAIL_ADDRESS": "EMAIL",
    "LOCATION": "LOCATION",
    "MEDICAL_LICENSE": "ID",
    "US_SSN": "ID",
    "IP_ADDRESS": "ID",
}

# Default NER-label → Presidio entity mapping used by spaCy / stanza / transformers engines
DEFAULT_MODEL_TO_PRESIDIO: dict[str, str] = {
    "PER": "PERSON",
    "PERSON": "PERSON",
    "NORP": "NRP",
    "FAC": "FACILITY",
    "LOC": "LOCATION",
    "GPE": "LOCATION",
    "LOCATION": "LOCATION",
    "ORG": "ORGANIZATION",
    "ORGANIZATION": "ORGANIZATION",
    "DATE": "DATE_TIME",
    "TIME": "DATE_TIME",
    # Clinical de-id models (e.g. obi/deid_roberta_i2b2, StanfordAIMI)
    "AGE": "AGE",
    "ID": "ID",
    "EMAIL": "EMAIL",
    "PATIENT": "PERSON",
    "STAFF": "PERSON",
    "HCW": "PERSON",
    "HOSP": "ORGANIZATION",
    "HOSPITAL": "ORGANIZATION",
    "PATORG": "ORGANIZATION",
    "FACILITY": "LOCATION",
    "PHONE": "PHONE_NUMBER",
}

SUPPORTED_MODEL_FAMILIES = ("spacy", "stanza", "huggingface", "flair")

KNOWN_MODELS = Literal[
    "spacy/en_core_web_sm",
    "spacy/en_core_web_md",
    "spacy/en_core_web_lg",
    "spacy/en_core_web_trf",
    "huggingface/obi/deid_roberta_i2b2",
    "huggingface/StanfordAIMI/stanford-deidentifier-base",
    "stanza/en",
    "flair/ner-english-large",
]

_MODEL_DESCRIPTIONS: dict[str, str] = {
    "spacy/en_core_web_sm": "spaCy small — fast, lower accuracy. Good for prototyping.",
    "spacy/en_core_web_md": "spaCy medium — balanced speed and accuracy.",
    "spacy/en_core_web_lg": "spaCy large — good general-purpose NER.",
    "spacy/en_core_web_trf": "spaCy transformer — highest accuracy, slower (requires GPU for speed).",
    "huggingface/obi/deid_roberta_i2b2": "RoBERTa fine-tuned on i2b2 clinical de-identification data.",
    "huggingface/StanfordAIMI/stanford-deidentifier-base": "Stanford AIMI clinical de-identifier (BERT-based).",
    "stanza/en": "Stanza English — Stanford NLP pipeline with BiLSTM NER.",
    "flair/ner-english-large": "Flair large NER — high accuracy, stacked embeddings.",
}


def default_base_labels() -> list[str]:
    """Default label space for the presidio_ner detector."""
    return sorted(set(DEFAULT_ENTITY_MAP.values()))


def _parse_model_spec(model: str) -> tuple[str, str]:
    """Parse a ``'family/model_path'`` string into ``(family, model_path)``.

    Examples::

        "spacy/en_core_web_lg"                        → ("spacy", "en_core_web_lg")
        "HuggingFace/obi/deid_roberta_i2b2"           → ("huggingface", "obi/deid_roberta_i2b2")
        "stanza/en"                                    → ("stanza", "en")
        "en_core_web_lg"                               → ("spacy", "en_core_web_lg")
    """
    parts = model.split("/", 1)
    if len(parts) == 2 and parts[0].lower() in SUPPORTED_MODEL_FAMILIES:
        return parts[0].lower(), parts[1]
    # No recognised prefix → default to spacy
    return "spacy", model


def _build_analyzer(
    model_family: str,
    model_path: str,
    model_to_presidio: dict[str, str] | None = None,
) -> Any:
    """Build a ``presidio_analyzer.AnalyzerEngine`` for the given model backend."""
    from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
    from presidio_analyzer.nlp_engine import NlpEngineProvider

    ner_mapping = model_to_presidio or DEFAULT_MODEL_TO_PRESIDIO

    if model_family == "spacy":
        nlp_configuration: dict[str, Any] = {
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": model_path}],
            "ner_model_configuration": {
                "model_to_presidio_entity_mapping": ner_mapping,
                "low_confidence_score_multiplier": 0.4,
                "low_score_entity_names": ["ORG", "ORGANIZATION"],
            },
        }
    elif model_family == "stanza":
        nlp_configuration = {
            "nlp_engine_name": "stanza",
            "models": [{"lang_code": "en", "model_name": model_path}],
            "ner_model_configuration": {
                "model_to_presidio_entity_mapping": ner_mapping,
            },
        }
    elif model_family == "huggingface":
        nlp_configuration = {
            "nlp_engine_name": "transformers",
            "models": [
                {
                    "lang_code": "en",
                    "model_name": {
                        "spacy": "en_core_web_sm",
                        "transformers": model_path,
                    },
                }
            ],
            "ner_model_configuration": {
                "model_to_presidio_entity_mapping": ner_mapping,
                "low_confidence_score_multiplier": 0.4,
                "low_score_entity_names": ["ID"],
                "labels_to_ignore": [
                    "CARDINAL",
                    "EVENT",
                    "LANGUAGE",
                    "LAW",
                    "MONEY",
                    "ORDINAL",
                    "PERCENT",
                    "PRODUCT",
                    "QUANTITY",
                    "WORK_OF_ART",
                ],
            },
        }
    elif model_family == "flair":
        import spacy as _spacy

        if not _spacy.util.is_package("en_core_web_sm"):
            _spacy.cli.download("en_core_web_sm")

        from flair_recognizer import FlairRecognizer  # type: ignore[import-untyped]

        nlp_configuration = {
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
        }
        nlp_engine = NlpEngineProvider(nlp_configuration=nlp_configuration).create_engine()
        registry = RecognizerRegistry()
        registry.load_predefined_recognizers(nlp_engine=nlp_engine)
        flair_recognizer = FlairRecognizer(model_path=model_path)
        registry.add_recognizer(flair_recognizer)
        registry.remove_recognizer("SpacyRecognizer")
        return AnalyzerEngine(nlp_engine=nlp_engine, registry=registry)
    else:
        raise ValueError(
            f"Unsupported model family {model_family!r}. "
            f"Supported: {', '.join(SUPPORTED_MODEL_FAMILIES)}"
        )

    nlp_engine = NlpEngineProvider(nlp_configuration=nlp_configuration).create_engine()
    registry = RecognizerRegistry()
    registry.load_predefined_recognizers(nlp_engine=nlp_engine)
    return AnalyzerEngine(nlp_engine=nlp_engine, registry=registry)


class PresidioNerConfig(BaseModel):
    """Configuration for the Presidio-based NER pipe."""

    model_config = ConfigDict(protected_namespaces=())

    model: KNOWN_MODELS = Field(
        default="spacy/en_core_web_lg",
        description="NLP model to use for NER.",
        json_schema_extra=field_ui(
            ui_group="Model",
            ui_order=1,
            ui_widget="described_select",
            ui_enum_descriptions=_MODEL_DESCRIPTIONS,
        ),
    )

    score_threshold: float = Field(
        default=0.35,
        description="Minimum Presidio score to keep a result.",
        json_schema_extra=field_ui(
            ui_group="Model",
            ui_order=2,
            ui_widget="slider",
        ),
    )

    entities: list[str] | None = Field(
        default=None,
        description="Presidio entity types to detect. ``None`` means all supported entities.",
        json_schema_extra=field_ui(
            ui_group="Advanced",
            ui_order=1,
            ui_widget="multiselect",
            ui_advanced=True,
        ),
    )

    language: str = Field(
        default="en",
        json_schema_extra=field_ui(
            ui_group="Advanced",
            ui_order=2,
            ui_widget="text",
            ui_advanced=True,
        ),
    )

    model_to_presidio: dict[str, str] | None = Field(
        default=None,
        description="Override the NER label → Presidio entity mapping. ``None`` uses the default.",
        json_schema_extra=field_ui(
            ui_group="Advanced",
            ui_order=3,
            ui_widget="key_value",
            ui_advanced=True,
        ),
    )

    entity_map: dict[str, str] = Field(
        default_factory=lambda: dict(DEFAULT_ENTITY_MAP),
        description=(
            "Map Presidio entity names to project PHI labels. Unmapped entities pass through as-is."
        ),
        json_schema_extra=field_ui(
            ui_group="Advanced",
            ui_order=4,
            ui_widget="key_value",
            ui_advanced=True,
        ),
    )

    source_name: str = Field(
        default="presidio_ner",
        json_schema_extra=field_ui(
            ui_group="Advanced",
            ui_order=5,
            ui_widget="text",
            ui_advanced=True,
        ),
    )

    label_mapping: dict[str, str | None] = detector_label_mapping_field()

    skip_overlapping: bool = Field(
        default=False,
        description="Drop new spans that overlap any existing span in the document.",
        json_schema_extra=field_ui(
            ui_group="Advanced",
            ui_order=99,
            ui_widget="switch",
            ui_advanced=True,
        ),
    )


class PresidioNerPipe(ConfigurablePipe):
    def __init__(self, config: PresidioNerConfig | None = None) -> None:
        try:
            import presidio_analyzer  # noqa: F401
        except ImportError as exc:
            raise ImportError(
                "presidio-analyzer is required for PresidioNerPipe. "
                "Install it with:  pip install 'clinical-deid-playground[presidio]'"
            ) from exc

        self._config = config or PresidioNerConfig()
        model_family, model_path = _parse_model_spec(self._config.model)
        self._analyzer = _build_analyzer(
            model_family, model_path, self._config.model_to_presidio
        )

    @property
    def base_labels(self) -> set[str]:
        m = self._config.entity_map
        return set(m.values()) | set(m.keys())

    @property
    def label_mapping(self) -> dict[str, str | None]:
        return dict(self._config.label_mapping)

    @property
    def labels(self) -> set[str]:
        return effective_detector_labels(self.base_labels, self._config.label_mapping)

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        text = doc.document.text
        results = self._analyzer.analyze(
            text=text,
            entities=self._config.entities,
            language=self._config.language,
            score_threshold=self._config.score_threshold,
        )

        found: list[PHISpan] = []
        for r in results:
            label = self._config.entity_map.get(r.entity_type, r.entity_type)
            found.append(
                PHISpan(
                    start=r.start,
                    end=r.end,
                    label=label,
                    confidence=r.score,
                    source=self._config.source_name,
                )
            )

        found.sort(key=lambda s: (s.start, s.end, s.label))
        found = apply_detector_label_mapping(found, self._config.label_mapping)
        return accumulate_spans(doc, found, skip_overlapping=self._config.skip_overlapping)
