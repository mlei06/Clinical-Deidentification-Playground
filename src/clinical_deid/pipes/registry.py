"""Pipe registry and JSON serialization.

Provides a central registry that maps type names to (config_class, pipe_class)
pairs, plus functions to load/dump entire pipelines from/to JSON.

JSON schema example::

    {
      "store_intermediary": false,
      "pipes": [
        {
          "type": "parallel",
          "strategy": "union",
          "detectors": [
            {"type": "regex_ner", "config": {"label_mapping": {"PHONE": "TEL", "DATE": null}}},
            {"type": "whitelist", "store_if_intermediary": true},
          ],
        },
        {
          "type": "parallel",
          "strategy": "consensus",
          "consensus_threshold": 2,
          "detectors": [
            {"type": "regex_ner"},
            {"type": "presidio_ner", "config": {"model": "HuggingFace/obi/deid_roberta_i2b2"}}
          ]
        },
        {"type": "label_mapper", "config": {"mapping": {"NAME": "PATIENT"}}},
        {"type": "resolve_spans", "config": {"strategy": "longest_non_overlapping"}}
      ]
    }
"""

from __future__ import annotations

import importlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from clinical_deid.pipes.base import ConfigurablePipe, Pipe

# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

_REGISTRY: dict[str, tuple[type[BaseModel], type]] = {}


def _import_dotted(path: str) -> type:
    """Import ``'some.module:ClassName'`` and return the class."""
    module_path, class_name = path.rsplit(":", 1)
    mod = importlib.import_module(module_path)
    return getattr(mod, class_name)


def register(name: str, config_cls: type[BaseModel], pipe_cls: type) -> None:
    """Register a pipe type so it can be referenced by *name* in JSON."""
    _REGISTRY[name] = (config_cls, pipe_cls)


def registered_pipes() -> dict[str, type[BaseModel]]:
    """Return ``{name: config_class}`` for all registered pipes."""
    return {name: cfg for name, (cfg, _) in _REGISTRY.items()}


# ---------------------------------------------------------------------------
# Pipe catalog — all known pipe types, including uninstalled ones
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PipeCatalogEntry:
    """Describes a pipe type that the system knows about."""

    name: str
    description: str
    role: str  # "detector", "span_transformer", "redactor", "preprocessor"
    extra: str | None  # pip extra name, e.g. "presidio", or None if always available
    install_hint: str  # human-readable install command
    config_path: str  # "module.path:ConfigClass"
    pipe_path: str  # "module.path:PipeClass"


_CATALOG: list[PipeCatalogEntry] = [
    PipeCatalogEntry(
        name="regex_ner",
        description="Regex-only PHI detection (pyDeid-style patterns per label)",
        role="detector",
        extra=None,
        install_hint="Included by default",
        config_path="clinical_deid.pipes.regex_ner.pipe:RegexNerConfig",
        pipe_path="clinical_deid.pipes.regex_ner.pipe:RegexNerPipe",
    ),
    PipeCatalogEntry(
        name="whitelist",
        description="Phrase / dictionary (gazetteer) matching per label; compose with regex_ner in parallel",
        role="detector",
        extra=None,
        install_hint="Included by default",
        config_path="clinical_deid.pipes.whitelist.pipe:WhitelistConfig",
        pipe_path="clinical_deid.pipes.whitelist.pipe:WhitelistPipe",
    ),
    PipeCatalogEntry(
        name="label_mapper",
        description="Remap span labels (e.g. PATIENT → PERSON)",
        role="span_transformer",
        extra=None,
        install_hint="Included by default",
        config_path="clinical_deid.pipes.combinators:LabelMapperConfig",
        pipe_path="clinical_deid.pipes.combinators:LabelMapper",
    ),
    PipeCatalogEntry(
        name="label_filter",
        description="Drop or keep only specific labels",
        role="span_transformer",
        extra=None,
        install_hint="Included by default",
        config_path="clinical_deid.pipes.combinators:LabelFilterConfig",
        pipe_path="clinical_deid.pipes.combinators:LabelFilter",
    ),
    PipeCatalogEntry(
        name="resolve_spans",
        description=(
            "Merge/dedupe/arbitrate overlapping spans (same strategies as parallel: union, "
            "exact_dedupe, consensus, max_confidence, longest_non_overlapping); use after one or more detectors"
        ),
        role="span_transformer",
        extra=None,
        install_hint="Included by default",
        config_path="clinical_deid.pipes.combinators:ResolveSpansConfig",
        pipe_path="clinical_deid.pipes.combinators:ResolveSpans",
    ),
    PipeCatalogEntry(
        name="blacklist",
        description=(
            "Remove spans matching a benign-term blacklist (pyDeid notes_common-style false-positive filter)"
        ),
        role="span_transformer",
        extra=None,
        install_hint="Included by default",
        config_path="clinical_deid.pipes.blacklist.pipe:BlacklistSpansConfig",
        pipe_path="clinical_deid.pipes.blacklist.pipe:BlacklistSpans",
    ),
    PipeCatalogEntry(
        name="presidio_ner",
        description="PHI detection via Microsoft Presidio (spaCy, HuggingFace, Stanza, Flair)",
        role="detector",
        extra="presidio",
        install_hint="pip install '.[presidio]'",
        config_path="clinical_deid.pipes.presidio_ner.pipe:PresidioNerConfig",
        pipe_path="clinical_deid.pipes.presidio_ner.pipe:PresidioNerPipe",
    ),
    PipeCatalogEntry(
        name="presidio_anonymizer",
        description="Redact/mask/hash/encrypt text using Microsoft Presidio Anonymizer",
        role="redactor",
        extra="presidio",
        install_hint="pip install '.[presidio]'",
        config_path="clinical_deid.pipes.presidio_anonymizer.pipe:PresidioAnonymizerConfig",
        pipe_path="clinical_deid.pipes.presidio_anonymizer.pipe:PresidioAnonymizerPipe",
    ),
    PipeCatalogEntry(
        name="pydeid_ner",
        description="Clinical PHI detection via pyDeid (names, dates, IDs, contacts, locations)",
        role="detector",
        extra="pydeid",
        install_hint="pip install '.[pydeid]'",
        config_path="clinical_deid.pipes.pydeid_ner.pipe:PyDeidNerConfig",
        pipe_path="clinical_deid.pipes.pydeid_ner.pipe:PyDeidNerPipe",
    ),
    PipeCatalogEntry(
        name="surrogate",
        description="Replace PHI with realistic fake data (Faker-based surrogate generation)",
        role="redactor",
        extra="scripts",
        install_hint="pip install '.[scripts]'",
        config_path="clinical_deid.pipes.surrogate.pipe:SurrogateConfig",
        pipe_path="clinical_deid.pipes.surrogate.pipe:SurrogatePipe",
    ),
    PipeCatalogEntry(
        name="span_resolver",
        description=(
            "Resolve overlapping spans: pick winner by longest, highest_confidence, or label priority; "
            "optionally merge adjacent same-label spans"
        ),
        role="span_transformer",
        extra=None,
        install_hint="Included by default",
        config_path="clinical_deid.pipes.span_resolver:SpanResolverConfig",
        pipe_path="clinical_deid.pipes.span_resolver:SpanResolverPipe",
    ),
    PipeCatalogEntry(
        name="consistency_propagator",
        description=(
            "Propagate high-confidence spans to all matching text occurrences in the document"
        ),
        role="span_transformer",
        extra=None,
        install_hint="Included by default",
        config_path="clinical_deid.pipes.consistency_propagator:ConsistencyPropagatorConfig",
        pipe_path="clinical_deid.pipes.consistency_propagator:ConsistencyPropagatorPipe",
    ),
    PipeCatalogEntry(
        name="llm_ner",
        description="LLM-prompted PHI detection via OpenAI-compatible chat API",
        role="detector",
        extra="llm",
        install_hint="pip install '.[llm]'",
        config_path="clinical_deid.pipes.llm_ner:LlmNerConfig",
        pipe_path="clinical_deid.pipes.llm_ner:LlmNerPipe",
    ),
]


_PIPE_ROLE_BY_NAME: dict[str, str] = {e.name: e.role for e in _CATALOG}


def _collect_redactors_in_spec(spec: Any) -> list[str]:
    """Collect pipe types with catalog role 'redactor' inside a JSON-ish pipe spec."""
    if not isinstance(spec, dict):
        return []
    pipe_type = spec.get("type")
    if not isinstance(pipe_type, str):
        return []

    role = _PIPE_ROLE_BY_NAME.get(pipe_type)
    found: list[str] = []
    if role == "redactor":
        found.append(pipe_type)

    # Structural recursion
    if pipe_type == "parallel":
        for d in spec.get("detectors", []):
            found.extend(_collect_redactors_in_spec(d))
    elif pipe_type == "pipeline":
        for p in spec.get("pipes", []):
            found.extend(_collect_redactors_in_spec(p))

    return list(dict.fromkeys(found))  # preserve order, de-dupe


def pipe_catalog() -> list[PipeCatalogEntry]:
    """Return the full catalog of known pipe types."""
    return list(_CATALOG)


def pipe_availability() -> list[dict[str, Any]]:
    """Return each known pipe type with its install status.

    Each entry has:
    - ``name``, ``description``, ``role``, ``install_hint`` from the catalog
    - ``installed`` (bool): whether the pipe is currently registered
    - ``extra``: pip extra group name, or null
    """
    registered = set(_REGISTRY)
    return [
        {
            "name": entry.name,
            "description": entry.description,
            "role": entry.role,
            "extra": entry.extra,
            "install_hint": entry.install_hint,
            "installed": entry.name in registered,
        }
        for entry in _CATALOG
    ]


# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------

def _load_pipeline_from_dict(spec: dict[str, Any]) -> Any:
    """Build :class:`~clinical_deid.pipes.combinators.Pipeline` from a dict with ``pipes``."""
    from clinical_deid.pipes.combinators import Pipeline

    if "pipes" not in spec:
        raise ValueError(f"pipeline spec missing 'pipes': {spec}")
    pipe_list = [load_pipe(p) for p in spec["pipes"]]
    flags = tuple(bool(p.get("store_if_intermediary", False)) for p in spec["pipes"])
    return Pipeline(
        pipes=pipe_list,
        store_intermediary=bool(spec.get("store_intermediary", False)),
        step_store_if_intermediary=flags,
    )


def pipeline_config_requests_intermediary(cfg: dict[str, Any]) -> bool:
    """Return True if *cfg* (stored pipeline JSON) enables intermediate trace capture anywhere."""

    if cfg.get("store_intermediary"):
        return True
    return _pipes_request_intermediary(cfg.get("pipes", []))


def _pipe_spec_requests_intermediary(p: dict[str, Any]) -> bool:
    if p.get("store_if_intermediary"):
        return True
    pt = p.get("type")
    if pt == "parallel":
        for d in p.get("detectors", []):
            if isinstance(d, dict) and _pipe_spec_requests_intermediary(d):
                return True
    elif pt == "pipeline":
        return pipeline_config_requests_intermediary(p)
    return False


def _pipes_request_intermediary(pipes: list[Any]) -> bool:
    for p in pipes:
        if isinstance(p, dict) and _pipe_spec_requests_intermediary(p):
            return True
    return False


def load_pipe(spec: dict[str, Any]) -> Pipe:
    """Recursively build a single pipe from a JSON-like dict."""
    from clinical_deid.pipes.combinators import ParallelBranch, ParallelDetectors

    pipe_type = spec.get("type")
    if pipe_type is None:
        raise ValueError(f"Pipe spec missing 'type': {spec}")

    # Structural types handled inline
    if pipe_type == "parallel":
        redactors = _collect_redactors_in_spec(spec)
        if redactors:
            raise ValueError(
                "ParallelDetectors only supports text-preserving detector/transformer pipes. "
                "Move any redactor pipes outside the parallel block. "
                f"Found redactor(s): {', '.join(sorted(redactors))}"
            )
        branches = [
            ParallelBranch(
                pipe=load_pipe(d),
                pipe_type=str(d.get("type", "unknown")),
                store_if_intermediary=bool(d.get("store_if_intermediary", False)),
            )
            for d in spec["detectors"]
        ]
        return ParallelDetectors(
            branches=branches,
            strategy=spec.get("strategy", "union"),
            consensus_threshold=spec.get("consensus_threshold", 2),
            store_if_intermediary=bool(spec.get("store_if_intermediary", False)),
        )

    if pipe_type == "pipeline":
        return _load_pipeline_from_dict(spec)

    # Registered pipes
    entry = _REGISTRY.get(pipe_type)
    if entry is None:
        raise ValueError(
            f"Unknown pipe type {pipe_type!r}. "
            f"Registered: {', '.join(sorted(_REGISTRY))}"
        )

    config_cls, pipe_cls = entry
    raw_config = spec.get("config") or {}
    config = config_cls.model_validate(raw_config)
    return pipe_cls(config)


def load_pipeline(source: dict[str, Any] | str | Path) -> Any:
    """Build a ``Pipeline`` from a JSON dict, JSON string, or file path."""
    if isinstance(source, Path):
        source = json.loads(source.read_text())
    elif isinstance(source, str):
        # Distinguish file path from JSON string
        if not source.lstrip().startswith("{"):
            source = json.loads(Path(source).read_text())
        else:
            source = json.loads(source)

    return _load_pipeline_from_dict(source)


# ---------------------------------------------------------------------------
# Dump
# ---------------------------------------------------------------------------

def _dump_pipeline_steps(pipeline: Any) -> dict[str, Any]:
    """Shared helper: serialize a pipeline's steps and flags into a dict."""
    out: dict[str, Any] = {"pipes": []}
    if pipeline.store_intermediary:
        out["store_intermediary"] = True
    flags = pipeline.step_store_if_intermediary
    for i, p in enumerate(pipeline.pipes):
        d = dump_pipe(p)
        if i < len(flags) and flags[i]:
            d["store_if_intermediary"] = True
        out["pipes"].append(d)
    return out


def dump_pipe(pipe: Pipe) -> dict[str, Any]:
    """Serialize a single pipe to a JSON-compatible dict."""
    from clinical_deid.pipes.combinators import LabelFilter, LabelMapper, ParallelDetectors, Pipeline

    if isinstance(pipe, ParallelDetectors):
        result = {
            "type": "parallel",
            "detectors": [],
        }
        for b in pipe.branches:
            d = dump_pipe(b.pipe)
            if b.store_if_intermediary:
                d["store_if_intermediary"] = True
            result["detectors"].append(d)
        strategy = pipe.strategy
        if isinstance(strategy, str):
            result["strategy"] = strategy
        else:
            result["strategy"] = "custom"
        if strategy == "consensus":
            result["consensus_threshold"] = pipe.consensus_threshold
        if pipe.store_if_intermediary:
            result["store_if_intermediary"] = True
        return result

    if isinstance(pipe, Pipeline):
        out = _dump_pipeline_steps(pipe)
        out["type"] = "pipeline"
        return out

    # Registered pipes — reverse lookup by class
    for name, (config_cls, pipe_cls) in _REGISTRY.items():
        if isinstance(pipe, pipe_cls):
            if isinstance(pipe, ConfigurablePipe):
                config = pipe.pipe_config
            else:
                config = pipe._config  # type: ignore[attr-defined]
            dumped = config.model_dump()
            # Omit fields that match defaults to keep JSON concise
            defaults = {}
            for field_name, field_info in config_cls.model_fields.items():
                if field_info.is_required():
                    continue
                default = field_info.get_default(call_default_factory=True)
                defaults[field_name] = default
            trimmed = {
                k: v for k, v in dumped.items() if k not in defaults or v != defaults[k]
            }
            result = {"type": name}
            if trimmed:
                result["config"] = trimmed
            return result

    raise ValueError(f"Cannot serialize pipe {type(pipe).__name__}: not in registry")


def dump_pipeline(pipeline: Any) -> dict[str, Any]:
    """Serialize a ``Pipeline`` to a JSON-compatible dict (top-level, no ``type`` key)."""
    return _dump_pipeline_steps(pipeline)


def dump_pipeline_json(pipeline: Any, indent: int = 2) -> str:
    """Serialize a ``Pipeline`` to a JSON string."""
    return json.dumps(dump_pipeline(pipeline), indent=indent)


def save_pipeline(pipeline: Any, path: str | Path) -> None:
    """Write a ``Pipeline`` to a JSON file."""
    Path(path).write_text(dump_pipeline_json(pipeline) + "\n")


# ---------------------------------------------------------------------------
# Register built-in pipes
# ---------------------------------------------------------------------------

def _register_builtins() -> None:
    """Register all built-in pipes from the catalog.

    Pipes whose optional dependencies are not installed are silently skipped.
    Always-available pipes (``extra is None``) re-raise on ``ImportError``.
    """
    for entry in _CATALOG:
        try:
            config_cls = _import_dotted(entry.config_path)
            pipe_cls = _import_dotted(entry.pipe_path)
            register(entry.name, config_cls, pipe_cls)
        except ImportError:
            if entry.extra is None:
                raise  # always-available pipes must not fail silently


_register_builtins()
