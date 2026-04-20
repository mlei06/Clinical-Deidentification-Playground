"""Custom NER pipe — load trained spaCy or HuggingFace models from ``models/``."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from clinical_deid.domain import AnnotatedDocument, PHISpan
from clinical_deid.pipes.base import ConfigurablePipe, DetectorWithLabelMapping
from clinical_deid.pipes.detector_label_mapping import (
    DETECTOR_LABEL_MAPPING,
    accumulate_spans,
    apply_detector_label_mapping,
    effective_detector_labels,
)
from clinical_deid.pipes.ui_schema import field_ui

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


class CustomNerConfig(BaseModel):
    """Load a trained NER model from ``models/{framework}/{name}/``."""

    model_name: str = Field(
        ...,
        title="Model name",
        description="Name of the model (must match a directory under models/).",
        json_schema_extra=field_ui(
            ui_group="Model",
            ui_order=1,
            ui_widget="model_select",
        ),
    )
    framework: Literal["spacy", "huggingface"] | None = Field(
        default=None,
        title="Framework",
        description=(
            "Model framework. If omitted, auto-detected from the model manifest."
        ),
        json_schema_extra=field_ui(
            ui_group="Model",
            ui_order=2,
            ui_widget="select",
        ),
    )
    confidence_threshold: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        title="Confidence threshold",
        description="Drop spans below this confidence score.",
        json_schema_extra=field_ui(
            ui_group="Detection",
            ui_order=3,
            ui_widget="slider",
        ),
    )
    device: str = Field(
        default="cpu",
        title="Device",
        description="Torch device for HuggingFace models (cpu, cuda, mps).",
        json_schema_extra=field_ui(
            ui_group="Detection",
            ui_order=4,
            ui_widget="text",
        ),
    )
    segmentation: Literal["auto", "truncate", "sentence"] = Field(
        default="auto",
        title="Segmentation",
        description=(
            "How to segment input for HuggingFace inference. 'auto' uses the "
            "mode the model was trained with (from its manifest). 'sentence' "
            "splits text into sentences and runs inference per sentence. "
            "'truncate' runs one forward pass and truncates at the model's "
            "context window."
        ),
        json_schema_extra=field_ui(
            ui_group="Detection",
            ui_order=5,
            ui_widget="select",
        ),
    )
    label_mapping: dict[str, str | None] = DETECTOR_LABEL_MAPPING


# ---------------------------------------------------------------------------
# Model loaders
# ---------------------------------------------------------------------------


def _resolve_model_path(model_name: str, framework: str | None) -> tuple[Path, dict[str, Any]]:
    """Find the model directory and load its manifest."""
    from clinical_deid.config import get_settings
    from clinical_deid.models import get_model

    settings = get_settings()
    info = get_model(settings.models_dir, model_name)

    if framework and info.framework != framework:
        raise ValueError(
            f"Model {model_name!r} is framework={info.framework!r}, "
            f"but config specifies framework={framework!r}"
        )

    return info.path, {
        "framework": info.framework,
        "labels": info.labels,
        "device": info.device,
        "trained_segmentation": info.training_meta.get("segmentation"),
    }


def _load_spacy_model(model_path: Path) -> Any:
    """Load a spaCy NER model from disk."""
    try:
        import spacy
    except ImportError as exc:
        raise ImportError(
            "spaCy is required for custom_ner with framework='spacy'. "
            "Install with: pip install '.[ner]'"
        ) from exc
    return spacy.load(model_path)


def _predict_spacy(
    nlp: Any,
    text: str,
    threshold: float,
    source: str,
) -> list[PHISpan]:
    """Run spaCy NER and convert to PHISpan."""
    doc = nlp(text)
    spans: list[PHISpan] = []
    for ent in doc.ents:
        conf = getattr(ent, "kb_id_", None)
        # spaCy doesn't provide confidence natively; use 1.0 as default
        confidence = 1.0
        if conf and isinstance(conf, (int, float)):
            confidence = float(conf)
        if confidence >= threshold:
            spans.append(PHISpan(
                start=ent.start_char,
                end=ent.end_char,
                label=ent.label_,
                confidence=confidence,
                source=source,
            ))
    return spans


def _resolve_segmentation_mode(
    requested: str,
    trained: str | None,
    model_name: str,
) -> str:
    """Resolve the effective inference segmentation mode.

    - ``auto`` → use the mode recorded in the manifest; default to ``truncate``
      for older manifests that don't record it.
    - explicit ``truncate``/``sentence`` → honored; log a warning when it
      differs from the mode the model was trained with, since context
      statistics at inference will not match training.
    """
    if requested == "auto":
        return trained or "truncate"
    if trained and trained != requested:
        logger.warning(
            "custom_ner: model %r was trained with segmentation=%r but "
            "inference is configured with segmentation=%r. Context at "
            "inference will differ from training.",
            model_name, trained, requested,
        )
    return requested


def _load_huggingface_model(model_path: Path, device: str) -> Any:
    """Load a HuggingFace token-classification pipeline from disk."""
    try:
        from transformers import pipeline as hf_pipeline
    except ImportError as exc:
        raise ImportError(
            "transformers is required for custom_ner with framework='huggingface'. "
            "Install with: pip install transformers torch"
        ) from exc
    return hf_pipeline(
        "token-classification",
        model=str(model_path),
        tokenizer=str(model_path),
        device=device,
        aggregation_strategy="simple",
    )


def _predict_huggingface(
    pipe: Any,
    text: str,
    threshold: float,
    source: str,
) -> list[PHISpan]:
    """Run HuggingFace NER pipeline and convert to PHISpan."""
    results = pipe(text)
    spans: list[PHISpan] = []
    for ent in results:
        score = ent.get("score", 1.0)
        if score < threshold:
            continue
        label = ent.get("entity_group") or ent.get("entity", "UNK")
        spans.append(PHISpan(
            start=ent["start"],
            end=ent["end"],
            label=label,
            confidence=round(score, 4),
            source=source,
        ))
    return spans


def _predict_huggingface_by_sentence(
    pipe: Any,
    text: str,
    threshold: float,
    source: str,
) -> list[PHISpan]:
    """Run the HF NER pipeline per sentence, remapping offsets to doc coords."""
    from clinical_deid.training.segmentation import sentence_offsets

    bounds = sentence_offsets(text)
    if not bounds:
        return []

    spans: list[PHISpan] = []
    for sent_start, sent_end in bounds:
        sub_text = text[sent_start:sent_end]
        if not sub_text:
            continue
        results = pipe(sub_text)
        for ent in results:
            score = ent.get("score", 1.0)
            if score < threshold:
                continue
            label = ent.get("entity_group") or ent.get("entity", "UNK")
            spans.append(PHISpan(
                start=ent["start"] + sent_start,
                end=ent["end"] + sent_start,
                label=label,
                confidence=round(score, 4),
                source=source,
            ))
    return spans


# ---------------------------------------------------------------------------
# Pipe
# ---------------------------------------------------------------------------


class CustomNerPipe(ConfigurablePipe):
    """Detector that loads a trained NER model from the models/ directory.

    Supports spaCy and HuggingFace frameworks. The model must be registered
    with a ``model_manifest.json`` under ``models/{framework}/{name}/``.
    """

    def __init__(self, config: CustomNerConfig) -> None:
        self._config = config
        self._model: Any = None
        self._manifest: dict[str, Any] | None = None
        self._framework: str | None = None
        self._segmentation: str = "truncate"

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return

        model_path, manifest = _resolve_model_path(
            self._config.model_name, self._config.framework
        )
        self._manifest = manifest
        self._framework = manifest["framework"]

        if self._framework == "spacy":
            self._model = _load_spacy_model(model_path)
        elif self._framework == "huggingface":
            device = self._config.device or manifest.get("device", "cpu")
            self._model = _load_huggingface_model(model_path, device)
            self._segmentation = _resolve_segmentation_mode(
                self._config.segmentation,
                manifest.get("trained_segmentation"),
                self._config.model_name,
            )
        else:
            raise ValueError(
                f"Unsupported framework {self._framework!r} for custom_ner. "
                f"Supported: spacy, huggingface"
            )

    @property
    def base_labels(self) -> set[str]:
        if self._manifest and self._manifest.get("labels"):
            return set(self._manifest["labels"])
        # Fall back to loading model manifest
        try:
            _, manifest = _resolve_model_path(
                self._config.model_name, self._config.framework
            )
            return set(manifest.get("labels", []))
        except Exception:
            return set()

    @property
    def label_mapping(self) -> dict[str, str | None]:
        return self._config.label_mapping

    @property
    def labels(self) -> set[str]:
        return effective_detector_labels(self.base_labels, self._config.label_mapping)

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        self._ensure_loaded()
        text = doc.document.text
        source = f"custom_ner:{self._config.model_name}"
        threshold = self._config.confidence_threshold

        if self._framework == "spacy":
            raw_spans = _predict_spacy(self._model, text, threshold, source)
        elif self._framework == "huggingface":
            if self._segmentation == "sentence":
                raw_spans = _predict_huggingface_by_sentence(
                    self._model, text, threshold, source
                )
            else:
                raw_spans = _predict_huggingface(self._model, text, threshold, source)
        else:
            raw_spans = []

        mapped = apply_detector_label_mapping(raw_spans, self._config.label_mapping)
        return accumulate_spans(doc, mapped)


def default_base_labels() -> list[str]:
    """Return empty list — labels come from the model manifest at runtime."""
    return []


def custom_ner_dependencies(config: dict[str, Any]) -> list[str]:
    """Return ``["model:<name>"]`` if the configured model is not registered, else ``[]``."""
    from clinical_deid.config import get_settings
    from clinical_deid.models import get_model

    model_name = (config or {}).get("model_name")
    if not model_name:
        return []
    try:
        get_model(get_settings().models_dir, model_name)
    except Exception:
        return [f"model:{model_name}"]
    return []
