"""Pipe combinators: Pipeline, ResolveSpans, LabelMapper, LabelFilter."""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from pydantic import BaseModel, Field

from clinical_deid.domain import AnnotatedDocument, PHISpan
from clinical_deid.pipes.base import ConfigurablePipe, Pipe
from clinical_deid.pipes.span_merge import MergeStrategy, apply_resolve_spans
from clinical_deid.pipes.trace import PipelineRunResult, PipelineTraceFrame, snapshot_document
from clinical_deid.pipes.ui_schema import field_ui


# ---------------------------------------------------------------------------
# ResolveSpans — span transformer (single- or multi-detector via span groups)
# ---------------------------------------------------------------------------


class ResolveSpansConfig(BaseModel):
    """Merge / dedupe / arbitrate overlapping spans.

    Passes ``[doc.spans]`` to the resolution logic, so accumulated spans from
    multiple detectors can be collapsed (e.g. ``longest_non_overlapping``).

    Strategies match :func:`~clinical_deid.pipes.span_merge.apply_resolve_spans`:

    - ``union``: sort and concatenate (no overlap handling).
    - ``exact_dedupe``: drop identical (start, end, label) only.
    - ``consensus``: requires multiple *groups*; with a single detector use threshold ``1``.
    - ``max_confidence``: greedy keep by confidence, no overlaps.
    - ``longest_non_overlapping``: greedy keep by span length, no overlaps (any label).
    """

    strategy: MergeStrategy = Field(
        default="union",
        description="How to merge span groups (here: a single group doc.spans).",
        json_schema_extra=field_ui(
            ui_group="Merge",
            ui_order=1,
            ui_widget="select",
            ui_help="Same strategies as parallel detector merge.",
        ),
    )
    consensus_threshold: int = Field(
        default=2,
        ge=1,
        description="For consensus: minimum agreeing groups; use 1 when resolving one detector list.",
        json_schema_extra=field_ui(
            ui_group="Merge",
            ui_order=2,
            ui_widget="number",
            ui_help="Only used when strategy is consensus.",
        ),
    )


class ResolveSpans(ConfigurablePipe):
    """SpanTransformer that applies :func:`~clinical_deid.pipes.span_merge.apply_resolve_spans` to ``doc.spans``."""

    def __init__(self, config: ResolveSpansConfig | None = None) -> None:
        self._config = config or ResolveSpansConfig()

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        merged = apply_resolve_spans(
            [list(doc.spans)],
            strategy=self._config.strategy,
            consensus_threshold=self._config.consensus_threshold,
        )
        return doc.with_spans(merged)


# ---------------------------------------------------------------------------
# LabelMapper
# ---------------------------------------------------------------------------


class LabelFilterConfig(BaseModel):
    """Configuration for LabelFilter.

    Provide *drop* to remove specific labels, or *keep* to retain only those labels.
    Exactly one of *drop* or *keep* must be set.
    """

    drop: list[str] | None = Field(
        default=None,
        json_schema_extra=field_ui(
            ui_group="Filter",
            ui_order=1,
            ui_widget="multiselect",
            ui_help="Remove spans with these labels. Do not set both drop and keep.",
        ),
    )
    keep: list[str] | None = Field(
        default=None,
        json_schema_extra=field_ui(
            ui_group="Filter",
            ui_order=2,
            ui_widget="multiselect",
            ui_help="Keep only these labels. Do not set both drop and keep.",
        ),
    )

    def model_post_init(self, __context: object) -> None:
        if self.drop and self.keep:
            raise ValueError("Provide either 'drop' or 'keep', not both")
        if not self.drop and not self.keep:
            raise ValueError("Provide either 'drop' or 'keep'")


class LabelFilter(ConfigurablePipe):
    """Remove or retain spans by label."""

    def __init__(self, config: LabelFilterConfig) -> None:
        self._config = config

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        if self._config.drop:
            drop_set = set(self._config.drop)
            out = [s for s in doc.spans if s.label not in drop_set]
        else:
            keep_set = set(self._config.keep)  # type: ignore[arg-type]
            out = [s for s in doc.spans if s.label in keep_set]
        return doc.with_spans(out)


class LabelMapperConfig(BaseModel):
    """Configuration for LabelMapper."""

    mapping: dict[str, str | None] = Field(
        ...,
        json_schema_extra=field_ui(
            ui_group="Mapping",
            ui_order=1,
            ui_widget="label_mapping",
            ui_help="Map a label to null to drop spans with that label.",
        ),
    )
    drop_unmapped: bool = Field(
        default=False,
        json_schema_extra=field_ui(
            ui_group="Mapping",
            ui_order=2,
            ui_widget="switch",
            ui_help="If true, drop spans whose label is not a key in mapping.",
        ),
    )


class LabelMapper(ConfigurablePipe):
    """SpanTransformer that remaps span labels.

    Map a label to ``null`` to drop spans with that label.
    Unmapped labels are kept as-is unless *drop_unmapped* is True.
    """

    def __init__(self, config: LabelMapperConfig) -> None:
        self._config = config

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        out: list[PHISpan] = []
        m = self._config.mapping
        for span in doc.spans:
            if span.label in m:
                new_label = m[span.label]
                if new_label is None:
                    continue
                out.append(span.model_copy(update={"label": new_label}))
            elif not self._config.drop_unmapped:
                out.append(span)
        return doc.with_spans(out)


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


def _pipe_type_label(pipe: Pipe) -> str:
    if isinstance(pipe, Pipeline):
        return "pipeline"
    return type(pipe).__name__


@dataclass
class Pipeline:
    """Top-level sequential runner.

    Entries can be any ``Pipe``, ``ResolveSpans``, ``BlacklistSpans``,
    or nested ``Pipeline``.

    Pass ``trace=True`` to :meth:`forward` to capture intermediate document
    state after every step.
    """

    pipes: list[Pipe | ResolveSpans | Pipeline] = field(
        default_factory=list
    )

    @property
    def labels(self) -> set[str]:
        """Union of all detector labels in the pipeline."""
        out: set[str] = set()
        for p in self.pipes:
            if hasattr(p, "labels"):
                out |= p.labels  # type: ignore[union-attr]
        return out

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        """Run the pipeline. Conforms to the :class:`Pipe` protocol."""
        return self.run(doc).final

    def run(
        self,
        doc: AnnotatedDocument,
        *,
        trace: bool = False,
        timing: bool = False,
        _path_prefix: str = "",
    ) -> PipelineRunResult:
        """Run the pipeline, optionally collecting trace frames and/or per-step timing.

        *trace* captures document snapshots (deep copy) after each step.
        *timing* records ``elapsed_ms`` per step and ``total_elapsed_ms`` on the result.
        Both can be enabled independently.
        """
        frames: list[PipelineTraceFrame] = []
        t_total = time.perf_counter() if timing else 0.0
        for i, pipe in enumerate(self.pipes):
            step_path = f"{_path_prefix}step_{i}" if _path_prefix else f"step_{i}"

            if isinstance(pipe, Pipeline):
                sub = pipe.run(doc, trace=trace, timing=timing, _path_prefix=f"{step_path}/")
                doc = sub.final
                frames.extend(sub.trace)
            else:
                t0 = time.perf_counter() if timing else 0.0
                doc = pipe.forward(doc)
                step_ms = (time.perf_counter() - t0) * 1000 if timing else None

                if trace or timing:
                    frames.append(
                        PipelineTraceFrame(
                            path=step_path,
                            stage="sequential",
                            pipe_type=_pipe_type_label(pipe),
                            document=snapshot_document(doc) if trace else None,
                            elapsed_ms=step_ms,
                        )
                    )

        total_ms = (time.perf_counter() - t_total) * 1000 if timing else None
        return PipelineRunResult(final=doc, trace=frames, total_elapsed_ms=total_ms)

    def __call__(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        return self.forward(doc)
