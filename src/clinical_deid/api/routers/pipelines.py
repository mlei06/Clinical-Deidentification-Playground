"""Pipeline CRUD — filesystem-backed.

Each pipeline is a JSON file in ``pipelines/``.  Create, list, update, delete
all operate on the filesystem — no database.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from clinical_deid.api.schemas import (
    BlacklistMergeResponse,
    CreatePipelineRequest,
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
from clinical_deid.pipes.registry import load_pipeline, pipe_availability, registered_pipes
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
        result.append(PipeTypeInfo(**entry, config_schema=config_schema))
    return result


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
    try:
        load_pipeline(body.config)
        return ValidatePipelineResponse(valid=True)
    except Exception as exc:
        return ValidatePipelineResponse(valid=False, error=str(exc))
