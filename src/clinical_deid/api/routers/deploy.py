"""Deploy configuration API — manage modes.json from the playground UI."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from clinical_deid.config import get_settings
from clinical_deid.mode_config import DEFAULT_MODES_PATH, DeployConfig, ModeEntry, load_mode_config, save_mode_config
from clinical_deid.pipeline_store import list_pipelines, load_pipeline_config
from clinical_deid.pipes.registry import pipe_availability

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


class ModeHealth(BaseModel):
    name: str
    pipeline: str
    description: str = ""
    available: bool
    missing: list[str] = []


class DeployHealthResponse(BaseModel):
    modes: list[ModeHealth]
    default_mode: str | None = None


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


def _pipeline_missing_deps(config: dict[str, Any]) -> list[str]:
    """Return a list of missing dependencies for a pipeline config.

    Checks each ``pipes`` entry: the pipe must be registered, and for
    ``custom_ner`` the referenced model must exist under ``models/``.
    """
    avail = {entry["name"]: entry for entry in pipe_availability()}
    missing: list[str] = []
    for pipe in config.get("pipes", []) or []:
        pipe_type = pipe.get("type")
        if not pipe_type:
            continue
        info = avail.get(pipe_type)
        if info is None:
            missing.append(f"pipe:{pipe_type}")
            continue
        if not info.get("installed"):
            missing.append(f"pipe:{pipe_type}")
            continue
        if not info.get("ready", True):
            missing.append(f"pipe:{pipe_type}")
            continue
        if pipe_type == "custom_ner":
            model_name = (pipe.get("config") or {}).get("model_name")
            if model_name:
                try:
                    from clinical_deid.models import get_model as _get_model

                    _get_model(get_settings().models_dir, model_name)
                except Exception:
                    missing.append(f"model:{model_name}")
    return missing


@router.get("/health", response_model=DeployHealthResponse)
def get_deploy_health() -> DeployHealthResponse:
    """Report per-mode availability so the UI can gray out broken modes.

    For each mode, loads its pipeline config and walks the ``pipes`` list,
    reporting any uninstalled pipe types or missing models.
    """
    cfg = load_mode_config(_modes_path())
    pipelines_dir = get_settings().pipelines_dir
    out: list[ModeHealth] = []
    for name, entry in cfg.modes.items():
        try:
            pipeline_cfg = load_pipeline_config(pipelines_dir, entry.pipeline)
            missing = _pipeline_missing_deps(pipeline_cfg)
        except FileNotFoundError:
            missing = [f"pipeline:{entry.pipeline}"]
        out.append(
            ModeHealth(
                name=name,
                pipeline=entry.pipeline,
                description=entry.description,
                available=not missing,
                missing=missing,
            )
        )
    out.sort(key=lambda m: m.name)
    return DeployHealthResponse(modes=out, default_mode=cfg.default_mode)


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
