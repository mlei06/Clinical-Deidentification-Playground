"""Pipe combinators: Pipeline, ParallelDetectors, ResolveSpans, LabelMapper, LabelFilter."""

from __future__ import annotations

from dataclasses import dataclass, field

from pydantic import BaseModel, Field

from clinical_deid.domain import AnnotatedDocument, PHISpan
from clinical_deid.pipes.base import Detector, Pipe
from clinical_deid.pipes.span_merge import MergeStrategy, apply_resolve_spans
from clinical_deid.pipes.ui_schema import field_ui
from clinical_deid.pipes.trace import PipelineRunResult, PipelineTraceFrame, snapshot_document


# ---------------------------------------------------------------------------
# ResolveSpans — span transformer (single- or multi-detector via span groups)
# ---------------------------------------------------------------------------


class ResolveSpansConfig(BaseModel):
    """Merge / dedupe / arbitrate overlapping spans.

    Passes ``[doc.spans]`` to the same resolution logic as :class:`ParallelDetectors`, so one
    detector’s overlapping spans can be collapsed (e.g. ``longest_non_overlapping``) without a
    parallel block.

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


class ResolveSpans:
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


class LabelFilter:
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


class LabelMapper:
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
# ParallelDetectors
# ---------------------------------------------------------------------------


@dataclass
class ParallelBranch:
    """One detector arm inside :class:`ParallelDetectors` (metadata for tracing + dump)."""

    pipe: Pipe
    pipe_type: str = "unknown"
    store_if_intermediary: bool = False


class ParallelDetectors:
    """Run multiple detectors on the same document and merge their spans.

    Uses :func:`~clinical_deid.pipes.span_merge.apply_resolve_spans` — the same strategies as
    :class:`ResolveSpans`.

    Merge strategies:
    - ``union``: keep all spans from every detector.
    - ``exact_dedupe``: identical (start, end, label) only once.
    - ``consensus``: keep spans agreed on by >= *consensus_threshold* detectors.
    - ``max_confidence``: greedily keep highest-confidence, skip overlaps.
    - ``longest_non_overlapping``: greedily keep longest spans, skip overlaps.
    """

    branches: list[ParallelBranch]
    strategy: MergeStrategy
    consensus_threshold: int
    store_if_intermediary: bool

    def __init__(
        self,
        detectors: list[Pipe] | None = None,
        *,
        branches: list[ParallelBranch] | None = None,
        strategy: MergeStrategy = "union",
        consensus_threshold: int = 2,
        store_if_intermediary: bool = False,
    ) -> None:
        if detectors is not None and branches is not None:
            raise ValueError("Pass either detectors= or branches=, not both")
        if branches is not None:
            self.branches = branches
        elif detectors is not None:
            self.branches = [ParallelBranch(pipe=p) for p in detectors]
        else:
            self.branches = []
        self.strategy = strategy
        self.consensus_threshold = consensus_threshold
        self.store_if_intermediary = store_if_intermediary

    @property
    def detectors(self) -> list[Pipe]:
        return [b.pipe for b in self.branches]

    @property
    def labels(self) -> set[str]:
        out: set[str] = set()
        for b in self.branches:
            if isinstance(b.pipe, Detector):
                out |= b.pipe.labels
        return out

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        span_groups: list[list[PHISpan]] = []
        for b in self.branches:
            branch_doc = b.pipe.forward(doc)
            # Parallel detection assumes spans are relative to the same input text.
            # If any branch mutates text (redactor/anonymizer), offsets become invalid.
            if branch_doc.document.text != doc.document.text:
                raise ValueError(
                    "ParallelDetectors only supports text-preserving pipes. "
                    "Move any redaction/anonymizer pipe outside the parallel block "
                    "(e.g. run parallel detectors first, then anonymize sequentially)."
                )
            span_groups.append(list(branch_doc.spans))
        merged = apply_resolve_spans(
            span_groups,
            strategy=self.strategy,
            consensus_threshold=self.consensus_threshold,
        )
        return doc.with_spans(merged)

    def forward_with_trace(
        self,
        doc: AnnotatedDocument,
        *,
        path: str,
        trace: list[PipelineTraceFrame],
        step_flag: bool,
        pipeline_store: bool,
    ) -> AnnotatedDocument:
        """Merge detectors like :meth:`forward`, optionally recording pre/post-merge snapshots."""
        span_groups: list[list[PHISpan]] = []
        for j, b in enumerate(self.branches):
            branch_doc = b.pipe.forward(doc)
            if branch_doc.document.text != doc.document.text:
                raise ValueError(
                    "ParallelDetectors only supports text-preserving pipes. "
                    "Move any redaction/anonymizer pipe outside the parallel block "
                    "(e.g. run parallel detectors first, then anonymize sequentially)."
                )
            span_groups.append(list(branch_doc.spans))
            capture_branch = (
                pipeline_store
                or step_flag
                or self.store_if_intermediary
                or b.store_if_intermediary
            )
            if capture_branch:
                trace.append(
                    PipelineTraceFrame(
                        path=f"{path}/parallel/branch_{j}",
                        stage="parallel_pre_merge",
                        pipe_type=b.pipe_type,
                        branch_index=j,
                        document=snapshot_document(branch_doc),
                        extra={"parallel_strategy": self.strategy},
                    )
                )

        merged = apply_resolve_spans(
            span_groups,
            strategy=self.strategy,
            consensus_threshold=self.consensus_threshold,
        )
        out = doc.with_spans(merged)
        branch_requested = any(b.store_if_intermediary for b in self.branches)
        capture_merge = (
            pipeline_store or step_flag or self.store_if_intermediary or branch_requested
        )
        if capture_merge:
            trace.append(
                PipelineTraceFrame(
                    path=f"{path}/parallel/post_merge",
                    stage="parallel_post_merge",
                    pipe_type="parallel",
                    branch_index=None,
                    document=snapshot_document(out),
                    extra={
                        "parallel_strategy": self.strategy,
                        "consensus_threshold": self.consensus_threshold,
                    },
                )
            )
        return out


def _pipe_type_label(pipe: Pipe) -> str:
    if isinstance(pipe, ParallelDetectors):
        return "parallel"
    if isinstance(pipe, Pipeline):
        return "pipeline"
    return type(pipe).__name__


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


@dataclass
class Pipeline:
    """Top-level sequential runner.

    Entries can be any ``Pipe``, ``ParallelDetectors``, ``ResolveSpans``, ``BlacklistSpans``,
    or nested ``Pipeline``.

    Set ``store_intermediary`` on the pipeline dict to capture every step; or set
    ``store_if_intermediary`` on individual pipe specs. For ``parallel`` blocks, each detector
    may set ``store_if_intermediary`` to capture outputs before merge.
    """

    pipes: list[Pipe | ParallelDetectors | ResolveSpans | Pipeline] = field(
        default_factory=list
    )
    store_intermediary: bool = False
    step_store_if_intermediary: tuple[bool, ...] = field(default_factory=tuple)

    @property
    def labels(self) -> set[str]:
        """Union of all detector labels in the pipeline."""
        out: set[str] = set()
        for p in self.pipes:
            if hasattr(p, "labels"):
                out |= p.labels  # type: ignore[union-attr]
        return out

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        for pipe in self.pipes:
            doc = pipe.forward(doc)
        return doc

    def forward_with_trace(
        self, doc: AnnotatedDocument, path_prefix: str = ""
    ) -> PipelineRunResult:
        """Run the pipeline and collect :class:`~clinical_deid.pipes.trace.PipelineTraceFrame` entries."""
        trace: list[PipelineTraceFrame] = []
        flags = self.step_store_if_intermediary
        for i, pipe in enumerate(self.pipes):
            step_path = f"{path_prefix}step_{i}" if path_prefix else f"step_{i}"
            step_flag = self.store_intermediary or (i < len(flags) and flags[i])

            if isinstance(pipe, Pipeline):
                sub = pipe.forward_with_trace(doc, path_prefix=f"{step_path}/")
                doc = sub.final
                trace.extend(sub.trace)
            elif isinstance(pipe, ParallelDetectors):
                doc = pipe.forward_with_trace(
                    doc,
                    path=step_path,
                    trace=trace,
                    step_flag=step_flag,
                    pipeline_store=self.store_intermediary,
                )
            else:
                doc = pipe.forward(doc)
                if step_flag:
                    trace.append(
                        PipelineTraceFrame(
                            path=step_path,
                            stage="sequential",
                            pipe_type=_pipe_type_label(pipe),
                            document=snapshot_document(doc),
                            extra={},
                        )
                    )

        return PipelineRunResult(final=doc, trace=trace)

    def __call__(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        return self.forward(doc)
