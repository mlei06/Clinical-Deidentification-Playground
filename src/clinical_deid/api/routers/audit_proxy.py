"""Proxy for production audit endpoints.

Forwards requests from the playground UI to the remote production API's
``/audit/*`` endpoints, so operators can view production audit data without
leaving the playground.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query

from clinical_deid.mode_config import DEFAULT_MODES_PATH, load_mode_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/audit/production", tags=["audit-production"])

_CLIENT_TIMEOUT = 15.0  # seconds


def _production_url() -> str:
    """Read the production API URL from the deploy config."""
    cfg = load_mode_config(DEFAULT_MODES_PATH)
    if not cfg.production_api_url:
        raise HTTPException(
            status_code=422,
            detail="production_api_url is not configured in modes.json",
        )
    return cfg.production_api_url.rstrip("/")


async def _proxy_get(path: str, params: dict[str, str | None]) -> Any:
    """Forward a GET request to the production API."""
    base = _production_url()
    clean_params = {k: v for k, v in params.items() if v is not None}
    try:
        async with httpx.AsyncClient(timeout=_CLIENT_TIMEOUT) as client:
            resp = await client.get(f"{base}{path}", params=clean_params)
        resp.raise_for_status()
        return resp.json()
    except httpx.ConnectError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"cannot reach production API at {base}: {exc}",
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=f"production API error: {exc.response.text}",
        ) from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail=f"production API timed out ({_CLIENT_TIMEOUT}s)",
        ) from exc


@router.get("/logs")
async def proxy_audit_logs(
    pipeline_name: str | None = Query(default=None),
    source: str | None = Query(default=None),
    command: str | None = Query(default=None),
    from_date: datetime | None = Query(default=None),
    to_date: datetime | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> Any:
    """Proxy audit log listing from the production API."""
    return await _proxy_get("/audit/logs", {
        "pipeline_name": pipeline_name,
        "source": source,
        "command": command,
        "from_date": from_date.isoformat() if from_date else None,
        "to_date": to_date.isoformat() if to_date else None,
        "limit": str(limit),
        "offset": str(offset),
    })


@router.get("/logs/{log_id}")
async def proxy_audit_log_detail(log_id: str) -> Any:
    """Proxy a single audit log detail from the production API."""
    return await _proxy_get(f"/audit/logs/{log_id}", {})


@router.get("/stats")
async def proxy_audit_stats(
    pipeline_name: str | None = Query(default=None),
    source: str | None = Query(default=None),
) -> Any:
    """Proxy audit stats from the production API."""
    return await _proxy_get("/audit/stats", {
        "pipeline_name": pipeline_name,
        "source": source,
    })
