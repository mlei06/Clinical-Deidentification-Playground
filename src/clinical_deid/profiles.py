"""Pre-built pipeline profiles for CLI usage (no database required).

Each profile function returns a plain ``dict`` pipeline config that can be
passed directly to :func:`~clinical_deid.pipes.registry.load_pipeline`.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def fast_profile() -> dict[str, Any]:
    """Regex + whitelist + blacklist + resolve.  ~10 ms, no ML."""
    return {
        "pipes": [
            {"type": "regex_ner"},
            {"type": "whitelist"},
            {"type": "blacklist"},
            {"type": "resolve_spans", "config": {"strategy": "longest_non_overlapping"}},
        ],
    }


def balanced_profile() -> dict[str, Any]:
    """Regex + whitelist + presidio (if installed) + resolve.  Falls back to fast."""
    from clinical_deid.pipes.registry import registered_pipes

    if "presidio_ner" not in registered_pipes():
        logger.warning(
            "presidio not installed — balanced profile falling back to fast "
            "(install with: pip install '.[presidio]')"
        )
        return fast_profile()

    return {
        "pipes": [
            {"type": "regex_ner"},
            {"type": "whitelist"},
            {"type": "presidio_ner"},
            {"type": "blacklist"},
            {"type": "resolve_spans", "config": {"strategy": "longest_non_overlapping"}},
        ],
    }


def accurate_profile() -> dict[str, Any]:
    """Regex + whitelist + presidio + consistency propagation + span resolution.

    Highest quality: chains all detectors, propagates high-confidence
    spans across the document, then resolves overlaps by confidence.
    """
    from clinical_deid.pipes.registry import registered_pipes

    if "presidio_ner" not in registered_pipes():
        raise RuntimeError(
            "accurate profile requires presidio — install with: pip install '.[presidio]'"
        )

    return {
        "pipes": [
            {"type": "regex_ner"},
            {"type": "whitelist"},
            {"type": "presidio_ner"},
            {"type": "blacklist"},
            {"type": "consistency_propagator", "config": {"min_confidence": 0.7}},
            {"type": "span_resolver", "config": {"strategy": "highest_confidence", "merge_adjacent": True}},
        ],
    }


_PROFILE_BUILDERS = {
    "fast": fast_profile,
    "balanced": balanced_profile,
    "accurate": accurate_profile,
}


def get_profile_config(
    name: str,
    *,
    redactor: str = "tag",
) -> dict[str, Any]:
    """Build a complete pipeline config dict for the named profile.

    Parameters
    ----------
    name : str
        One of ``"fast"``, ``"balanced"``, ``"accurate"``.
    redactor : str
        ``"tag"`` (default, ``[LABEL]`` replacement in CLI output layer) or
        ``"surrogate"`` (appends the surrogate pipe to the pipeline).
    """
    builder = _PROFILE_BUILDERS.get(name)
    if builder is None:
        raise ValueError(f"Unknown profile {name!r}. Choose from: {sorted(_PROFILE_BUILDERS)}")

    config = builder()

    if redactor == "surrogate":
        config["pipes"].append({"type": "surrogate"})

    return config
