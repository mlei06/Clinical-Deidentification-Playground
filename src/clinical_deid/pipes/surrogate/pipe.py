"""Surrogate replacement redactor: replaces spans with realistic fake data."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from clinical_deid.domain import AnnotatedDocument, Document
from clinical_deid.pipes.base import ConfigurablePipe
from clinical_deid.pipes.surrogate.packs import CLINICAL_PHI_SURROGATE
from clinical_deid.pipes.ui_schema import field_ui

# JSON-schema UI hint: strategy → labels for the default clinical_phi pack.
SURROGATE_STRATEGIES: dict[str, list[str]] = CLINICAL_PHI_SURROGATE.strategies_to_labels()


class SurrogateConfig(BaseModel):
    """Configuration for the surrogate replacement pipe."""

    model_config = ConfigDict(
        json_schema_extra={"ui_surrogate_strategies": SURROGATE_STRATEGIES},
    )

    seed: int | None = Field(
        default=None,
        description="Random seed for reproducible surrogates. None for random.",
        json_schema_extra=field_ui(ui_group="General", ui_order=1, ui_widget="number"),
    )
    consistency: bool = Field(
        default=True,
        description="Same original text with same label produces the same surrogate within a document.",
        json_schema_extra=field_ui(ui_group="General", ui_order=2, ui_widget="switch"),
    )
    strategy_pack: str = Field(
        default="clinical_phi",
        description=(
            "Name of the registered surrogate strategy pack to use. "
            "Built-ins: 'clinical_phi' (default), 'generic_pii'."
        ),
        json_schema_extra=field_ui(ui_group="General", ui_order=3, ui_widget="text", ui_advanced=True),
    )


class SurrogatePipe(ConfigurablePipe):
    """Redactor: replace detected PHI spans with realistic synthetic data (Faker)."""

    def __init__(self, config: SurrogateConfig | None = None) -> None:
        try:
            import faker  # noqa: F401
        except ImportError as exc:
            raise ImportError(
                "faker is required for SurrogatePipe. "
                "Install it with:  pip install 'clinical-deid-playground[scripts]'"
            ) from exc

        self._config = config or SurrogateConfig()

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        if not doc.spans:
            return doc

        from clinical_deid.pipes.surrogate.packs import get_surrogate_pack
        from clinical_deid.pipes.surrogate.strategies import SurrogateGenerator

        pack = get_surrogate_pack(self._config.strategy_pack)
        gen = SurrogateGenerator(
            seed=self._config.seed,
            consistency=self._config.consistency,
            label_to_strategy=pack.label_to_strategy,
        )
        text = doc.document.text

        # Sort spans R-to-L so offset changes don't affect earlier spans
        sorted_spans = sorted(doc.spans, key=lambda s: s.start, reverse=True)
        result_text = text
        for span in sorted_spans:
            original = text[span.start : span.end]
            replacement = gen.replace(span.label, original)
            result_text = result_text[: span.start] + replacement + result_text[span.end :]

        metadata = {
            **doc.document.metadata,
            "pre_redaction_spans": [s.model_dump() for s in doc.spans],
        }
        return AnnotatedDocument(
            document=Document(
                id=doc.document.id,
                text=result_text,
                metadata=metadata,
            ),
            spans=[],  # offsets no longer valid in redacted text
        )
