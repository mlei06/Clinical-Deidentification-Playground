"""Pipeline CRUD — filesystem-backed.

Each pipeline is a JSON file in ``pipelines/``.  Create, list, update, delete
all operate on the filesystem — no database.
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from clinical_deid.api.schemas import (
    BlacklistMergeResponse,
    ComputeLabelsRequest,
    ComputeLabelsResponse,
    CreatePipelineRequest,
    NeuronerLabelSpaceBundle,
    NerBuiltinInfo,
    ParseListFileResult,
    ParseListFilesResponse,
    PipelineDetail,
    PipeTypeInfo,
    UpdatePipelineRequest,
    ValidatePipelineRequest,
    ValidatePipelineResponse,
)
from clinical_deid.config import get_settings
from clinical_deid.pipeline_store import (
    delete_pipeline,
    list_pipelines,
    load_pipeline_config,
    save_pipeline_config,
)
from clinical_deid.dictionary_store import DictionaryStore
from clinical_deid.pipes.regex_ner import builtin_regex_label_names
from clinical_deid.pipes.registry import compute_base_labels, load_pipeline, pipe_availability, registered_pipes
from clinical_deid.pipes.ui_schema import pipe_config_json_schema
from clinical_deid.pipes.whitelist.lists import parse_list_file

router = APIRouter(prefix="/pipelines", tags=["pipelines"])

MAX_UPLOAD_BYTES = 2 * 1024 * 1024  # 2 MB per file


def _pipelines_dir():
    return get_settings().pipelines_dir


async def _read_upload(uf: UploadFile) -> str:
    raw = await uf.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"file {uf.filename!r} exceeds {MAX_UPLOAD_BYTES // 1024} KB limit",
        )
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=422, detail=f"file {uf.filename!r} is not valid UTF-8"
        ) from exc


def _validate_config(config: dict) -> None:
    try:
        load_pipeline(config)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Static routes — MUST be before /{pipeline_name}
# ---------------------------------------------------------------------------


@router.get("/pipe-types", response_model=list[PipeTypeInfo])
def list_pipe_types() -> list[PipeTypeInfo]:
    """List all known pipe types and install status."""
    reg = registered_pipes()
    result: list[PipeTypeInfo] = []
    for entry in pipe_availability():
        config_schema = None
        config_cls = reg.get(entry["name"])
        if config_cls is not None:
            config_schema = pipe_config_json_schema(config_cls)
        base_labels = entry.get("base_labels")
        if config_schema and base_labels:
            _inject_base_labels(config_schema, base_labels, entry["name"])
        if config_schema:
            _inject_dict_info(config_schema)
            _inject_dynamic_options(config_schema)
        result.append(PipeTypeInfo(**entry, config_schema=config_schema))
    return result


_LABEL_AWARE_WIDGETS = {"label_space", "label_regex", "unified_label", "whitelist_label"}


def _inject_base_labels(
    config_schema: dict, base_labels: list[str], pipe_type: str
) -> None:
    """Embed ``ui_base_labels``, ``ui_pipe_type``, and (for unified_label)
    ``ui_builtin_patterns`` into any label-aware property schema so the
    frontend widget can read them directly."""
    from clinical_deid.pipes.regex_ner import BUILTIN_REGEX_PATTERNS

    for prop in config_schema.get("properties", {}).values():
        if not isinstance(prop, dict):
            continue
        widget = prop.get("ui_widget")
        if widget not in _LABEL_AWARE_WIDGETS:
            continue
        prop["ui_base_labels"] = base_labels
        prop["ui_pipe_type"] = pipe_type
        if widget == "unified_label":
            prop["ui_builtin_patterns"] = {
                label: pat for label, pat in BUILTIN_REGEX_PATTERNS.items()
            }
        if widget == "whitelist_label":
            store = DictionaryStore(get_settings().dictionaries_dir)
            wl_dicts = store.list_dictionaries(kind="whitelist")
            dicts_by_label: dict[str, list[dict]] = {}
            for d in wl_dicts:
                if d.label:
                    dicts_by_label.setdefault(d.label, []).append({
                        "name": d.name,
                        "filename": d.filename,
                        "term_count": d.term_count,
                    })
            prop["ui_dictionaries_by_label"] = dicts_by_label


def _inject_dict_info(config_schema: dict) -> None:
    """Inject dictionary metadata into blacklist_dicts widgets."""
    for prop in config_schema.get("properties", {}).values():
        if not isinstance(prop, dict):
            continue
        if prop.get("ui_widget") == "blacklist_dicts":
            store = DictionaryStore(get_settings().dictionaries_dir)
            bl_dicts = store.list_dictionaries(kind="blacklist")
            prop["ui_blacklist_dicts"] = [
                {
                    "name": d.name,
                    "filename": d.filename,
                    "term_count": d.term_count,
                }
                for d in bl_dicts
            ]


_OPTIONS_SOURCE_RESOLVERS: dict[str, Any] = {
    "neuroner_models": lambda: sorted(
        p.name for p in Path("models/neuroner").resolve().iterdir() if p.is_dir()
    )
    if Path("models/neuroner").resolve().is_dir()
    else [],
}


def _inject_dynamic_options(config_schema: dict) -> None:
    """Populate ``enum`` for properties that declare a ``ui_options_source``."""
    for prop in config_schema.get("properties", {}).values():
        if not isinstance(prop, dict):
            continue
        source = prop.get("ui_options_source")
        if not source:
            continue
        resolver = _OPTIONS_SOURCE_RESOLVERS.get(source)
        if resolver is None:
            continue
        options = resolver()
        if options:
            prop["enum"] = options


@router.post("/pipe-types/{name}/labels", response_model=ComputeLabelsResponse)
def compute_pipe_labels(name: str, body: ComputeLabelsRequest | None = None) -> ComputeLabelsResponse:
    """Compute the effective base labels for a pipe type given optional config.

    For NeuroNER, ``labels`` are **post-``entity_map``** names (what ``label_mapping`` keys use).
    ``neuroner_manifest_labels`` are the raw tags from ``model_manifest.json`` for comparison.
    """
    config = body.config if body else None
    labels = compute_base_labels(name, config)
    neuroner_model: str | None = None
    neuroner_manifest_labels: list[str] | None = None
    if name == "neuroner_ner":
        from clinical_deid.config import get_settings
        from clinical_deid.models import get_model
        from clinical_deid.pipes.neuroner_ner.pipe import NeuroNerConfig

        cfg = NeuroNerConfig.model_validate(config or {})
        neuroner_model = cfg.model
        try:
            info = get_model(get_settings().models_dir, cfg.model)
            if info.framework == "neuroner" and info.labels:
                neuroner_manifest_labels = sorted(info.labels)
        except (KeyError, ValueError, OSError):
            pass
    return ComputeLabelsResponse(
        labels=labels,
        neuroner_model=neuroner_model,
        neuroner_manifest_labels=neuroner_manifest_labels,
    )


@router.get(
    "/pipe-types/neuroner_ner/label-space-bundle",
    response_model=NeuronerLabelSpaceBundle,
)
def neuroner_label_space_bundle() -> NeuronerLabelSpaceBundle:
    """Return manifest labels for every NeuroNER model plus the default ``entity_map``.

    The playground uses this once per session so changing ``model`` does not require another request.
    """
    from clinical_deid.models import list_models
    from clinical_deid.pipes.neuroner_ner.pipe import DEFAULT_ENTITY_MAP, NeuroNerConfig

    labels_by_model: dict[str, list[str]] = {}
    for info in list_models(get_settings().models_dir, framework="neuroner"):
        labels_by_model[info.name] = sorted(info.labels)
    cfg = NeuroNerConfig()
    return NeuronerLabelSpaceBundle(
        labels_by_model=labels_by_model,
        default_entity_map=dict(DEFAULT_ENTITY_MAP),
        default_model=cfg.model,
    )


@router.get("/ner/builtins", response_model=NerBuiltinInfo)
def ner_builtins() -> NerBuiltinInfo:
    store = DictionaryStore(get_settings().dictionaries_dir)
    wl_dicts = store.list_dictionaries(kind="whitelist")
    whitelist_labels = sorted({d.label for d in wl_dicts if d.label})
    return NerBuiltinInfo(
        regex_labels=builtin_regex_label_names(),
        whitelist_labels=whitelist_labels,
    )


@router.post("/whitelist/parse-lists", response_model=ParseListFilesResponse)
async def whitelist_parse_lists(
    files: Annotated[list[UploadFile], File()],
    labels: Annotated[list[str], Form()],
) -> ParseListFilesResponse:
    if not files:
        raise HTTPException(status_code=422, detail="at least one file is required")
    if len(files) != len(labels):
        raise HTTPException(
            status_code=422,
            detail=f"expected same number of files and labels (got {len(files)} files, {len(labels)} labels)",
        )
    results: list[ParseListFileResult] = []
    for uf, label in zip(files, labels, strict=True):
        text = await _read_upload(uf)
        terms = parse_list_file(text, filename=uf.filename or "")
        results.append(
            ParseListFileResult(
                label=label.strip().upper(),
                filename=uf.filename or "",
                terms=terms,
                count=len(terms),
            )
        )
    return ParseListFilesResponse(results=results)


@router.post("/blacklist/parse-wordlists", response_model=BlacklistMergeResponse)
async def blacklist_parse_wordlists(
    files: Annotated[list[UploadFile], File()],
) -> BlacklistMergeResponse:
    if not files:
        raise HTTPException(status_code=422, detail="at least one file is required")
    merged: set[str] = set()
    names: list[str] = []
    for uf in files:
        text = await _read_upload(uf)
        for t in parse_list_file(text, filename=uf.filename or ""):
            u = t.strip()
            if u:
                merged.add(u)
        names.append(uf.filename or "")
    out = sorted(merged, key=lambda x: x.casefold())
    return BlacklistMergeResponse(terms=out, count=len(out), source_files=names)


# ---------------------------------------------------------------------------
# Pipeline CRUD — filesystem
# ---------------------------------------------------------------------------


@router.post("", response_model=PipelineDetail, status_code=201)
def create_pipeline(body: CreatePipelineRequest) -> PipelineDetail:
    """Create a named pipeline (writes JSON file)."""
    _validate_config(body.config)
    pdir = _pipelines_dir()
    path = pdir / f"{body.name}.json"
    if path.exists():
        raise HTTPException(status_code=409, detail="pipeline name already exists")
    save_pipeline_config(pdir, body.name, body.config)
    return PipelineDetail(name=body.name, config=body.config)


@router.get("", response_model=list[PipelineDetail])
def list_all_pipelines() -> list[PipelineDetail]:
    """List all saved pipelines."""
    return [
        PipelineDetail(name=p.name, config=p.config)
        for p in list_pipelines(_pipelines_dir())
    ]


@router.get("/{pipeline_name}", response_model=PipelineDetail)
def get_pipeline(pipeline_name: str) -> PipelineDetail:
    try:
        config = load_pipeline_config(_pipelines_dir(), pipeline_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return PipelineDetail(name=pipeline_name, config=config)


@router.put("/{pipeline_name}", response_model=PipelineDetail)
def update_pipeline(pipeline_name: str, body: UpdatePipelineRequest) -> PipelineDetail:
    pdir = _pipelines_dir()
    path = pdir / f"{pipeline_name}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"pipeline {pipeline_name!r} not found")
    if body.config is not None:
        _validate_config(body.config)
        save_pipeline_config(pdir, pipeline_name, body.config)
    config = load_pipeline_config(pdir, pipeline_name)
    return PipelineDetail(name=pipeline_name, config=config)


@router.delete("/{pipeline_name}", status_code=204)
def delete_pipeline_endpoint(pipeline_name: str) -> None:
    try:
        delete_pipeline(_pipelines_dir(), pipeline_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{pipeline_name}/validate", response_model=ValidatePipelineResponse)
def validate_pipeline(pipeline_name: str, body: ValidatePipelineRequest) -> ValidatePipelineResponse:
    pdir = _pipelines_dir()
    path = pdir / f"{pipeline_name}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"pipeline {pipeline_name!r} not found")
    config = body.config if body.config else load_pipeline_config(pdir, pipeline_name)
    try:
        load_pipeline(config)
        return ValidatePipelineResponse(valid=True)
    except Exception as exc:
        return ValidatePipelineResponse(valid=False, error=str(exc))
