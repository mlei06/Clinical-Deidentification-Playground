"""Redactor pipe backed by Microsoft Presidio Anonymizer.

Consumes PHI spans and produces anonymised text. One operator applied
uniformly to all entity types.

JSON config example::

    {"type": "presidio_anonymizer", "config": {"operator": "replace", "new_value": "[REDACTED]"}}
    {"type": "presidio_anonymizer", "config": {"operator": "mask", "masking_char": "*", "chars_to_mask": 4}}
    {"type": "presidio_anonymizer", "config": {"operator": "hash", "hash_type": "sha256"}}
    {"type": "presidio_anonymizer", "config": {"operator": "redact"}}
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from clinical_deid.domain import AnnotatedDocument, Document, PHISpan
from clinical_deid.pipes.base import ConfigurablePipe
from clinical_deid.pipes.ui_schema import field_ui


class PresidioAnonymizerConfig(BaseModel):
    """Configuration for the Presidio Anonymizer redactor pipe.

    One operator is applied uniformly to every detected entity.

    Supported operators and their extra fields:

    - ``replace``:  ``new_value`` (str, default ``"<ENTITY_TYPE>"``).
    - ``redact``:   no extra fields — removes entity text entirely.
    - ``mask``:     ``masking_char`` (str, default ``"*"``),
      ``chars_to_mask`` (int, default ``100``), ``from_end`` (bool, default ``false``).
    - ``hash``:     ``hash_type`` (``"sha256"`` | ``"sha512"``, default ``"sha256"``).
    - ``encrypt``:  ``key`` (str, 16/24/32 bytes).
    - ``keep``:     no extra fields — leaves entity text unchanged.
    """

    operator: Literal["replace", "redact", "mask", "hash", "encrypt", "keep"] = Field(
        default="replace",
        json_schema_extra=field_ui(ui_group="Operator", ui_order=1, ui_widget="select"),
    )

    # replace
    new_value: str | None = Field(
        default=None,
        json_schema_extra=field_ui(
            ui_group="Operator parameters",
            ui_order=1,
            ui_widget="text",
            ui_visible_when={"field": "operator", "equals": "replace"},
            ui_placeholder="<ENTITY_TYPE>",
        ),
    )

    # mask
    masking_char: str = Field(
        default="*",
        json_schema_extra=field_ui(
            ui_group="Operator parameters",
            ui_order=2,
            ui_widget="text",
            ui_visible_when={"field": "operator", "equals": "mask"},
        ),
    )
    chars_to_mask: int = Field(
        default=100,
        json_schema_extra=field_ui(
            ui_group="Operator parameters",
            ui_order=3,
            ui_widget="number",
            ui_visible_when={"field": "operator", "equals": "mask"},
        ),
    )
    from_end: bool = Field(
        default=False,
        json_schema_extra=field_ui(
            ui_group="Operator parameters",
            ui_order=4,
            ui_widget="switch",
            ui_visible_when={"field": "operator", "equals": "mask"},
        ),
    )

    # hash
    hash_type: Literal["sha256", "sha512"] = Field(
        default="sha256",
        json_schema_extra=field_ui(
            ui_group="Operator parameters",
            ui_order=5,
            ui_widget="select",
            ui_visible_when={"field": "operator", "equals": "hash"},
        ),
    )

    # encrypt
    key: str | None = Field(
        default=None,
        json_schema_extra=field_ui(
            ui_group="Operator parameters",
            ui_order=6,
            ui_widget="password",
            ui_visible_when={"field": "operator", "equals": "encrypt"},
            ui_help="AES key: 16, 24, or 32 bytes.",
        ),
    )


# Map operator name → which config fields are its params
_OPERATOR_PARAMS: dict[str, tuple[str, ...]] = {
    "replace": ("new_value",),
    "redact": (),
    "mask": ("masking_char", "chars_to_mask", "from_end"),
    "hash": ("hash_type",),
    "encrypt": ("key",),
    "keep": (),
}


def _spans_to_recognizer_results(spans: list[PHISpan]) -> list[Any]:
    """Convert ``PHISpan`` list to Presidio ``RecognizerResult`` list."""
    from presidio_analyzer import RecognizerResult

    return [
        RecognizerResult(
            entity_type=span.label,
            start=span.start,
            end=span.end,
            score=span.confidence if span.confidence is not None else 1.0,
        )
        for span in spans
    ]


class PresidioAnonymizerPipe(ConfigurablePipe):
    """Redactor that uses Presidio Anonymizer to consume spans and transform text."""

    def __init__(self, config: PresidioAnonymizerConfig | None = None) -> None:
        try:
            from presidio_anonymizer import AnonymizerEngine
        except ImportError as exc:
            raise ImportError(
                "presidio-anonymizer is required for PresidioAnonymizerPipe. "
                "Install it with:  pip install 'clinical-deid-playground[presidio]'"
            ) from exc

        self._config = config or PresidioAnonymizerConfig()
        self._engine = AnonymizerEngine()

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        if not doc.spans:
            return doc

        from presidio_anonymizer.entities import OperatorConfig

        recognizer_results = _spans_to_recognizer_results(doc.spans)

        # Build operator params from config fields
        param_keys = _OPERATOR_PARAMS.get(self._config.operator, ())
        params: dict[str, Any] = {}
        for key in param_keys:
            val = getattr(self._config, key)
            if val is not None:
                params[key] = val

        operator_config = OperatorConfig(self._config.operator, params if params else None)

        result = self._engine.anonymize(
            text=doc.document.text,
            analyzer_results=recognizer_results,
            operators={"DEFAULT": operator_config},
        )

        return AnnotatedDocument(
            document=Document(
                id=doc.document.id,
                text=result.text,
                metadata=doc.document.metadata,
            ),
            spans=[],  # spans consumed — offsets no longer valid
        )
