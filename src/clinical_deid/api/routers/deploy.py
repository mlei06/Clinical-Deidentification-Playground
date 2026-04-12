"""Deploy configuration API — manage modes.json from the playground UI."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from clinical_deid.config import get_settings
from clinical_deid.mode_config import DEFAULT_MODES_PATH, DeployConfig, ModeEntry, load_mode_config, save_mode_config
from clinical_deid.pipeline_store import list_pipelines

router = APIRouter(prefix="/deploy", tags=["deploy"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ModeEntrySchema(BaseModel):
    pipeline: str
    description: str = ""


class DeployConfigResponse(BaseModel):
    modes: dict[str, ModeEntrySchema]
    default_mode: str | None = None
    allowed_pipelines: list[str] | None = None
    production_api_url: str | None = None


class UpdateDeployConfigRequest(BaseModel):
    modes: dict[str, ModeEntrySchema]
    default_mode: str | None = None
    allowed_pipelines: list[str] | None = None
    production_api_url: str | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


def _modes_path() -> Path:
    return DEFAULT_MODES_PATH


@router.get("", response_model=DeployConfigResponse)
def get_deploy_config() -> DeployConfigResponse:
    """Read the current deploy configuration (modes + allowlist)."""
    cfg = load_mode_config(_modes_path())
    return DeployConfigResponse(
        modes={
            name: ModeEntrySchema(pipeline=entry.pipeline, description=entry.description)
            for name, entry in cfg.modes.items()
        },
        default_mode=cfg.default_mode,
        allowed_pipelines=cfg.allowed_pipelines,
        production_api_url=cfg.production_api_url,
    )


@router.get("/pipelines", response_model=list[str])
def list_available_pipeline_names() -> list[str]:
    """List all saved pipeline names (for the UI to populate dropdowns)."""
    return [p.name for p in list_pipelines(get_settings().pipelines_dir)]


@router.put("", response_model=DeployConfigResponse)
def update_deploy_config(body: UpdateDeployConfigRequest) -> DeployConfigResponse:
    """Write an updated deploy configuration."""
    modes = {
        name: ModeEntry(pipeline=entry.pipeline, description=entry.description)
        for name, entry in body.modes.items()
    }
    cfg = DeployConfig(
        modes=modes,
        default_mode=body.default_mode,
        allowed_pipelines=body.allowed_pipelines,
        production_api_url=body.production_api_url,
    )
    save_mode_config(cfg, _modes_path())
    return DeployConfigResponse(
        modes=body.modes,
        default_mode=body.default_mode,
        allowed_pipelines=body.allowed_pipelines,
        production_api_url=body.production_api_url,
    )
