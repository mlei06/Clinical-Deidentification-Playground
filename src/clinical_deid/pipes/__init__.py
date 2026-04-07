from clinical_deid.pipes.base import (
    ConfigurablePipe,
    Detector,
    DetectorWithLabelMapping,
    Pipe,
    Preprocessor,
    Redactor,
    SpanTransformer,
)
from clinical_deid.pipes.detector_label_mapping import (
    DETECTOR_LABEL_MAPPING,
    DETECTOR_LABEL_MAPPING_DESCRIPTION,
    accumulate_spans,
    apply_detector_label_mapping,
    detector_label_mapping_field,
    effective_detector_labels,
)
from clinical_deid.pipes.ui_schema import field_ui, pipe_config_json_schema
from clinical_deid.pipes.blacklist import (
    BlacklistSpans,
    BlacklistSpansConfig,
    blacklist_regions_for_text,
)
from clinical_deid.pipes.combinators import (
    LabelMapper,
    LabelMapperConfig,
    MergeStrategy,
    Pipeline,
    ResolveSpans,
    ResolveSpansConfig,
)
from clinical_deid.pipes.regex_ner import (
    BUILTIN_REGEX_PATTERNS,
    RegexNerConfig,
    RegexNerLabelConfig,
    RegexNerPipe,
    builtin_regex_label_names,
)
from clinical_deid.pipes.registry import (
    dump_pipeline,
    dump_pipeline_json,
    load_pipeline,
    pipe_availability,
    pipe_catalog,
    pipeline_config_requests_intermediary,
    register,
    registered_pipes,
    save_pipeline,
)
from clinical_deid.pipes.trace import PipelineRunResult, PipelineTraceFrame, snapshot_document
from clinical_deid.pipes.span_merge import apply_resolve_spans
from clinical_deid.pipes.whitelist import WhitelistConfig, WhitelistPipe, WhitelistLabelConfig, bundled_whitelist_label_names

__all__ = [
    # Base
    "ConfigurablePipe",
    # Protocols
    "Detector",
    "DetectorWithLabelMapping",
    "DETECTOR_LABEL_MAPPING",
    "DETECTOR_LABEL_MAPPING_DESCRIPTION",
    "detector_label_mapping_field",
    "apply_detector_label_mapping",
    "accumulate_spans",
    "effective_detector_labels",
    "field_ui",
    "pipe_config_json_schema",
    "Pipe",
    "Preprocessor",
    "Redactor",
    "SpanTransformer",
    # Combinators
    "LabelMapper",
    "LabelMapperConfig",
    "MergeStrategy",
    "Pipeline",
    "PipelineRunResult",
    "PipelineTraceFrame",
    "snapshot_document",
    "ResolveSpans",
    "ResolveSpansConfig",
    "apply_resolve_spans",
    # Span transformers
    "BlacklistSpans",
    "BlacklistSpansConfig",
    "blacklist_regions_for_text",
    # Detectors
    "BUILTIN_REGEX_PATTERNS",
    "RegexNerLabelConfig",
    "RegexNerConfig",
    "RegexNerPipe",
    "WhitelistLabelConfig",
    "WhitelistConfig",
    "WhitelistPipe",
    "builtin_regex_label_names",
    "bundled_whitelist_label_names",
    # Registry / serialization
    "dump_pipeline",
    "dump_pipeline_json",
    "load_pipeline",
    "pipe_availability",
    "pipe_catalog",
    "pipeline_config_requests_intermediary",
    "register",
    "registered_pipes",
    "save_pipeline",
]

# Optional: Presidio pipes — available when `pip install .[presidio]`
try:
    from clinical_deid.pipes.presidio_anonymizer import (
        PresidioAnonymizerConfig,
        PresidioAnonymizerPipe,
    )
    from clinical_deid.pipes.presidio_ner import PresidioNerConfig, PresidioNerPipe

    __all__ += [
        "PresidioNerConfig",
        "PresidioNerPipe",
        "PresidioAnonymizerConfig",
        "PresidioAnonymizerPipe",
    ]
except ImportError:
    pass

# Optional: pyDeid pipe — available when pyDeid is cloned into project root
try:
    from clinical_deid.pipes.pydeid_ner import PyDeidNerConfig, PyDeidNerPipe

    __all__ += [
        "PyDeidNerConfig",
        "PyDeidNerPipe",
    ]
except ImportError:
    pass
