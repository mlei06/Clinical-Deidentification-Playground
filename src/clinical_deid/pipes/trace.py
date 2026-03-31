"""Intermediate pipeline outputs for UI / debugging."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from clinical_deid.domain import AnnotatedDocument


def snapshot_document(doc: AnnotatedDocument) -> AnnotatedDocument:
    """Deep copy so later pipe stages cannot mutate a trace frame."""
    return doc.model_copy(deep=True)


@dataclass
class PipelineTraceFrame:
    """One captured stage: document state + metadata for display."""

    path: str
    stage: str
    pipe_type: str
    document: AnnotatedDocument
    branch_index: int | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class PipelineRunResult:
    """Result of :func:`forward_with_trace`."""

    final: AnnotatedDocument
    trace: list[PipelineTraceFrame]

    def frames_as_jsonable(self) -> list[dict[str, Any]]:
        """Frames with each document as ``model_dump()`` for API responses."""
        return [
            {
                "path": f.path,
                "stage": f.stage,
                "pipe_type": f.pipe_type,
                "branch_index": f.branch_index,
                "document": f.document.model_dump(),
                "extra": f.extra,
            }
            for f in self.trace
        ]
