"""Surrogate replacement redactor: replaces PHI with realistic fake data."""

from __future__ import annotations

from pydantic import BaseModel, Field

from clinical_deid.domain import AnnotatedDocument, Document
from clinical_deid.pipes.ui_schema import field_ui


class SurrogateConfig(BaseModel):
    """Configuration for the surrogate replacement pipe."""

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


class SurrogatePipe:
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

        from clinical_deid.pipes.surrogate.strategies import SurrogateGenerator

        gen = SurrogateGenerator(
            seed=self._config.seed, consistency=self._config.consistency
        )
        text = doc.document.text

        # Sort spans R-to-L so offset changes don't affect earlier spans
        sorted_spans = sorted(doc.spans, key=lambda s: s.start, reverse=True)
        result_text = text
        for span in sorted_spans:
            original = text[span.start : span.end]
            replacement = gen.replace(span.label, original)
            result_text = result_text[: span.start] + replacement + result_text[span.end :]

        return AnnotatedDocument(
            document=Document(
                id=doc.document.id,
                text=result_text,
                metadata=doc.document.metadata,
            ),
            spans=[],  # spans consumed — offsets no longer valid
        )
