from __future__ import annotations

import threading
from typing import Any

from sqlmodel import SQLModel, create_engine

from clinical_deid.config import get_settings
from clinical_deid.pipes.base import Pipe

_engine = None
_engine_lock = threading.Lock()

# Pipeline object cache keyed by config_hash to avoid rebuilding pipe chains
# (which may load ML models) on every request.
_pipeline_cache: dict[str, Pipe] = {}
_pipeline_cache_lock = threading.Lock()
_PIPELINE_CACHE_MAX = 32


def reset_engine() -> None:
    """Test helper: clear cached engine after changing ``CLINICAL_DEID_DATABASE_URL``."""
    global _engine
    with _engine_lock:
        _engine = None


def get_engine():
    global _engine
    if _engine is not None:
        return _engine
    with _engine_lock:
        if _engine is None:
            settings = get_settings()
            p = settings.sqlite_path
            if p is not None:
                p.parent.mkdir(parents=True, exist_ok=True)
            connect_args = (
                {"check_same_thread": False}
                if settings.database_url.startswith("sqlite")
                else {}
            )
            _engine = create_engine(
                settings.database_url, echo=False, connect_args=connect_args
            )
    return _engine


def init_db() -> None:
    from clinical_deid.tables import (  # noqa: F401
        AuditLogRecord,
        EvalRunRecord,
        PipelineRecord,
        PipelineVersionRecord,
    )

    SQLModel.metadata.create_all(get_engine())


# ---------------------------------------------------------------------------
# Pipeline cache
# ---------------------------------------------------------------------------


def get_cached_pipeline(config_hash: str, config: dict[str, Any]) -> Pipe:
    """Return a cached pipeline for *config_hash*, building it on first access."""
    cached = _pipeline_cache.get(config_hash)
    if cached is not None:
        return cached
    with _pipeline_cache_lock:
        # Double-check after acquiring lock
        cached = _pipeline_cache.get(config_hash)
        if cached is not None:
            return cached
        from clinical_deid.pipes.registry import load_pipeline

        pipe_chain = load_pipeline(config)
        # Evict oldest entries when cache is full
        if len(_pipeline_cache) >= _PIPELINE_CACHE_MAX:
            oldest_key = next(iter(_pipeline_cache))
            del _pipeline_cache[oldest_key]
        _pipeline_cache[config_hash] = pipe_chain
        return pipe_chain


def clear_pipeline_cache() -> None:
    """Evict all cached pipeline objects."""
    with _pipeline_cache_lock:
        _pipeline_cache.clear()
