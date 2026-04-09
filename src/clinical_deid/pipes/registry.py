"""Pipe registry and JSON serialization.

Provides a central registry that maps type names to (config_class, pipe_class)
pairs, plus functions to load/dump entire pipelines from/to JSON.

JSON schema example::

    {
      "pipes": [
        {"type": "regex_ner", "config": {"label_mapping": {"PHONE": "TEL", "DATE": null}}},
        {"type": "whitelist"},
        {"type": "presidio_ner", "config": {"model": "HuggingFace/obi/deid_roberta_i2b2"}},
        {"type": "label_mapper", "config": {"mapping": {"NAME": "PATIENT"}}},
        {"type": "resolve_spans", "config": {"strategy": "longest_non_overlapping"}}
      ]
    }
"""

from __future__ import annotations

import importlib
import json
import warnings
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
    # Optional callable returning (ready: bool, details: dict) for pipes whose
    # availability depends on runtime state beyond Python imports (e.g. venvs,
    # downloaded models, embeddings).  ``None`` means "installed == ready".
    check_ready: str | None = None  # "module.path:function_name"


_CATALOG: list[PipeCatalogEntry] = [
    PipeCatalogEntry(
        name="regex_ner",
        description="Regex-only PHI detection (built-in clinical patterns per label)",
        role="detector",
        extra=None,
        install_hint="Included by default",
        config_path="clinical_deid.pipes.regex_ner.pipe:RegexNerConfig",
        pipe_path="clinical_deid.pipes.regex_ner.pipe:RegexNerPipe",
    ),
    PipeCatalogEntry(
        name="whitelist",
        description="Phrase / dictionary (gazetteer) matching per label; chain with regex_ner for combined coverage",
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
            "Merge/dedupe/arbitrate overlapping spans (union, exact_dedupe, consensus, "
            "max_confidence, longest_non_overlapping); use after one or more detectors"
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
            "Remove spans matching a benign-term blacklist (false-positive filter)"
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
    PipeCatalogEntry(
        name="neuroner_ner",
        description="Clinical PHI detection via NeuroNER LSTM-CRF (i2b2, MIMIC models; Python 3.7 subprocess)",
        role="detector",
        extra=None,
        install_hint="Run ./scripts/setup_neuroner.sh (Python 3.7 venv + models + GloVe embeddings)",
        config_path="clinical_deid.pipes.neuroner_ner.pipe:NeuroNerConfig",
        pipe_path="clinical_deid.pipes.neuroner_ner.pipe:NeuroNerPipe",
        check_ready="clinical_deid.pipes.neuroner_ner.pipe:check_neuroner_ready",
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
    if pipe_type == "pipeline":
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
    - ``ready`` (bool): whether the pipe can actually run (always True when
      there is no ``check_ready`` hook and the pipe is installed)
    - ``ready_details`` (dict | null): granular status from ``check_ready``
    """
    registered = set(_REGISTRY)
    out: list[dict[str, Any]] = []
    for entry in _CATALOG:
        installed = entry.name in registered
        ready = installed
        ready_details: dict[str, Any] | None = None

        if installed and entry.check_ready is not None:
            try:
                check_fn = _import_dotted(entry.check_ready)
                ready, ready_details = check_fn()
            except Exception as exc:
                ready = False
                ready_details = {"error": str(exc)}

        out.append({
            "name": entry.name,
            "description": entry.description,
            "role": entry.role,
            "extra": entry.extra,
            "install_hint": entry.install_hint,
            "installed": installed,
            "ready": ready,
            "ready_details": ready_details,
        })
    return out


# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------

def _load_pipeline_from_dict(spec: dict[str, Any]) -> Any:
    """Build :class:`~clinical_deid.pipes.combinators.Pipeline` from a dict with ``pipes``."""
    from clinical_deid.pipes.combinators import Pipeline

    if "pipes" not in spec:
        raise ValueError(f"pipeline spec missing 'pipes': {spec}")
    pipe_list: list[Pipe] = []
    for p in spec["pipes"]:
        result = load_pipe(p)
        if isinstance(result, list):
            pipe_list.extend(result)
        else:
            pipe_list.append(result)
    return Pipeline(pipes=pipe_list)


def load_pipe(spec: dict[str, Any]) -> Pipe | list[Pipe]:
    """Recursively build a single pipe from a JSON-like dict.

    Returns a list of pipes for deprecated ``"parallel"`` blocks (flattened
    into the parent pipeline).
    """
    pipe_type = spec.get("type")
    if pipe_type is None:
        raise ValueError(f"Pipe spec missing 'type': {spec}")

    # Backward-compat: flatten deprecated parallel blocks into sequential detectors
    if pipe_type == "parallel":
        warnings.warn(
            '"type": "parallel" is deprecated. Chain detectors sequentially instead '
            "and use resolve_spans for overlap handling.",
            DeprecationWarning,
            stacklevel=2,
        )
        pipes: list[Pipe] = []
        for d in spec.get("detectors", []):
            result = load_pipe(d)
            if isinstance(result, list):
                pipes.extend(result)
            else:
                pipes.append(result)
        return pipes

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
        stripped = source.lstrip()
        if stripped.startswith("{") or stripped.startswith("["):
            source = json.loads(source)
        else:
            source = json.loads(Path(source).read_text())

    return _load_pipeline_from_dict(source)


# ---------------------------------------------------------------------------
# Dump
# ---------------------------------------------------------------------------

def _dump_pipeline_steps(pipeline: Any) -> dict[str, Any]:
    """Shared helper: serialize a pipeline's steps into a dict."""
    out: dict[str, Any] = {"pipes": []}
    for p in pipeline.pipes:
        out["pipes"].append(dump_pipe(p))
    return out


def dump_pipe(pipe: Pipe) -> dict[str, Any]:
    """Serialize a single pipe to a JSON-compatible dict."""
    from clinical_deid.pipes.combinators import LabelFilter, LabelMapper, Pipeline

    if isinstance(pipe, Pipeline):
        out = _dump_pipeline_steps(pipe)
        out["type"] = "pipeline"
        return out

    # Registered pipes — reverse lookup by class
    for name, (config_cls, pipe_cls) in _REGISTRY.items():
        if isinstance(pipe, pipe_cls):
            if isinstance(pipe, ConfigurablePipe):
                config = pipe.pipe_config
            elif hasattr(pipe, "_config"):
                config = pipe._config  # type: ignore[attr-defined]
            else:
                raise ValueError(
                    f"Cannot serialize pipe {type(pipe).__name__}: "
                    f"not a ConfigurablePipe and has no _config attribute"
                )
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
