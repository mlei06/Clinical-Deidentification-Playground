from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, model_validator


class Document(BaseModel):
    id: str
    text: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class PHISpan(BaseModel):
    start: int
    end: int
    label: str
    confidence: float | None = None
    source: str | None = None

    @model_validator(mode="after")
    def span_order(self) -> PHISpan:
        if self.start < 0 or self.end < 0 or self.start >= self.end:
            raise ValueError(f"invalid span bounds: start={self.start}, end={self.end}")
        return self


class AnnotatedDocument(BaseModel):
    document: Document
    spans: list[PHISpan] = Field(default_factory=list)

    @model_validator(mode="after")
    def spans_match_text(self) -> AnnotatedDocument:
        n = len(self.document.text)
        for s in self.spans:
            if s.end > n:
                raise ValueError(
                    f"span [{s.start}:{s.end}) exceeds text length {n} for doc {self.document.id!r}"
                )
        return self

    def with_spans(self, spans: list[PHISpan]) -> AnnotatedDocument:
        return AnnotatedDocument(document=self.document, spans=spans)


def validate_against_text(text: str, spans: list[PHISpan]) -> None:
    n = len(text)
    for s in spans:
        if s.start < 0 or s.end > n or s.start >= s.end:
            raise ValueError(f"invalid span [{s.start}:{s.end}) for text length {n}")
