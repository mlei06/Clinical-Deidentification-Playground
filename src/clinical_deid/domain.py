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


def tag_replace(text: str, spans: list[PHISpan]) -> str:
    """Replace spans with ``[LABEL]`` tags, handling overlaps.

    When spans overlap, the longest span wins.  Ties are broken by earliest
    start, then alphabetical label.  Fully or partially covered spans are
    dropped so replacements never corrupt each other.
    """
    if not spans:
        return text

    # Dedupe and pick winners: longest span first, then earliest start
    sorted_spans = sorted(
        spans,
        key=lambda s: (-(s.end - s.start), s.start, s.label),
    )

    # Greedily select non-overlapping spans
    selected: list[PHISpan] = []
    for s in sorted_spans:
        if any(s.start < sel.end and s.end > sel.start for sel in selected):
            continue
        selected.append(s)

    # Replace right-to-left to preserve offsets
    selected.sort(key=lambda s: s.start, reverse=True)
    result = text
    for s in selected:
        result = result[: s.start] + f"[{s.label}]" + result[s.end :]
    return result
