from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from sqlmodel import select

from clinical_deid.api.deps import (
    SessionDep,
    get_current_version,
    get_pipeline_or_404,
)
from clinical_deid.api.schemas import (
    BlacklistMergeResponse,
    CreatePipelineRequest,
    NerBuiltinInfo,
    ParseListFileResult,
    ParseListFilesResponse,
    PipelineDetail,
    PipelineSummary,
    PipelineVersionDetail,
    PipeTypeInfo,
    UpdatePipelineRequest,
    ValidatePipelineRequest,
    ValidatePipelineResponse,
)
from clinical_deid.pipes.regex_ner import builtin_regex_label_names
from clinical_deid.pipes.registry import load_pipeline, pipe_availability, registered_pipes
from clinical_deid.pipes.ui_schema import pipe_config_json_schema
from clinical_deid.pipes.whitelist import bundled_whitelist_label_names
from clinical_deid.pipes.whitelist.lists import parse_list_file
from clinical_deid.tables import (
    PipelineRecord,
    PipelineVersionRecord,
    config_hash,
)

router = APIRouter(prefix="/pipelines", tags=["pipelines"])

MAX_UPLOAD_BYTES = 2 * 1024 * 1024  # 2 MB per file


async def _read_upload(uf: UploadFile) -> str:
    """Read an uploaded file with size guard and UTF-8 decode."""
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


def _version_detail(ver: PipelineVersionRecord) -> PipelineVersionDetail:
    return PipelineVersionDetail(
        id=ver.id,
        version=ver.version,
        config=ver.config,
        config_hash=ver.config_hash,
        created_at=ver.created_at,
    )


def _pipeline_detail(
    pipeline: PipelineRecord, ver: PipelineVersionRecord
) -> PipelineDetail:
    return PipelineDetail(
        id=pipeline.id,
        name=pipeline.name,
        description=pipeline.description,
        latest_version=pipeline.latest_version,
        is_active=pipeline.is_active,
        created_at=pipeline.created_at,
        updated_at=pipeline.updated_at,
        current_version=_version_detail(ver),
    )


def _validate_config(config: dict) -> None:
    """Validate pipeline config by attempting to build it."""
    try:
        load_pipeline(config)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Static routes — MUST be defined before /{pipeline_id} to avoid shadowing
# ---------------------------------------------------------------------------


@router.get("/pipe-types", response_model=list[PipeTypeInfo])
def list_pipe_types() -> list[PipeTypeInfo]:
    """List all known pipe types and whether they are installed.

    Installed pipes include their JSON config schema so the UI can render
    dynamic forms for pipeline composition.
    """
    reg = registered_pipes()  # {name: config_class}
    result: list[PipeTypeInfo] = []
    for entry in pipe_availability():
        config_schema = None
        config_cls = reg.get(entry["name"])
        if config_cls is not None:
            config_schema = pipe_config_json_schema(config_cls)
        result.append(
            PipeTypeInfo(
                **entry,
                config_schema=config_schema,
            )
        )
    return result


@router.get("/ner/builtins", response_model=NerBuiltinInfo)
def ner_builtins() -> NerBuiltinInfo:
    """Packaged regex labels and whitelist phrase-file labels."""
    return NerBuiltinInfo(
        regex_labels=builtin_regex_label_names(),
        whitelist_labels=bundled_whitelist_label_names(),
    )


@router.post("/whitelist/parse-lists", response_model=ParseListFilesResponse)
async def whitelist_parse_lists(
    files: Annotated[list[UploadFile], File()],
    labels: Annotated[list[str], Form()],
) -> ParseListFilesResponse:
    """Parse uploaded files into term lists for ``whitelist`` ``per_label`` config."""
    if not files:
        raise HTTPException(status_code=422, detail="at least one file is required")
    if len(files) != len(labels):
        raise HTTPException(
            status_code=422,
            detail=(
                f"expected the same number of files and labels "
                f"(got {len(files)} files, {len(labels)} labels)"
            ),
        )
    results: list[ParseListFileResult] = []
    for uf, label in zip(files, labels, strict=True):
        text = await _read_upload(uf)
        terms = parse_list_file(text, filename=uf.filename or "")
        label_norm = label.strip().upper()
        results.append(
            ParseListFileResult(
                label=label_norm,
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
    """Merge multiple uploads into one deduped ``terms`` list for ``blacklist``."""
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
# Parameterised routes
# ---------------------------------------------------------------------------


@router.post("", response_model=PipelineDetail, status_code=201)
def create_pipeline(
    session: SessionDep, body: CreatePipelineRequest
) -> PipelineDetail:
    _validate_config(body.config)

    existing = session.exec(
        select(PipelineRecord).where(PipelineRecord.name == body.name)
    ).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="pipeline name already exists")

    now = datetime.now(timezone.utc)
    pipeline = PipelineRecord(
        name=body.name,
        description=body.description,
        latest_version=1,
        created_at=now,
        updated_at=now,
    )
    session.add(pipeline)
    session.flush()

    ver = PipelineVersionRecord(
        pipeline_id=pipeline.id,
        version=1,
        config=body.config,
        config_hash=config_hash(body.config),
        created_at=now,
    )
    session.add(ver)
    session.flush()

    return _pipeline_detail(pipeline, ver)


@router.get("", response_model=list[PipelineSummary])
def list_pipelines(session: SessionDep) -> list[PipelineSummary]:
    stmt = select(PipelineRecord).where(PipelineRecord.is_active == True)  # noqa: E712
    records = session.exec(stmt).all()
    return [
        PipelineSummary(
            id=r.id,
            name=r.name,
            description=r.description,
            latest_version=r.latest_version,
            is_active=r.is_active,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in records
    ]


@router.get("/{pipeline_id}", response_model=PipelineDetail)
def get_pipeline(session: SessionDep, pipeline_id: str) -> PipelineDetail:
    pipeline = get_pipeline_or_404(session, pipeline_id)
    ver = get_current_version(session, pipeline)
    return _pipeline_detail(pipeline, ver)


@router.put("/{pipeline_id}", response_model=PipelineDetail)
def update_pipeline(
    session: SessionDep, pipeline_id: str, body: UpdatePipelineRequest
) -> PipelineDetail:
    pipeline = get_pipeline_or_404(session, pipeline_id)
    now = datetime.now(timezone.utc)

    if body.description is not None:
        pipeline.description = body.description
        pipeline.updated_at = now

    if body.config is not None:
        _validate_config(body.config)
        new_hash = config_hash(body.config)

        current_ver = get_current_version(session, pipeline)
        if new_hash != current_ver.config_hash:
            new_version = pipeline.latest_version + 1
            ver = PipelineVersionRecord(
                pipeline_id=pipeline.id,
                version=new_version,
                config=body.config,
                config_hash=new_hash,
                created_at=now,
            )
            session.add(ver)
            pipeline.latest_version = new_version
            pipeline.updated_at = now

    session.add(pipeline)
    session.flush()

    ver = get_current_version(session, pipeline)
    return _pipeline_detail(pipeline, ver)


@router.delete("/{pipeline_id}", status_code=204)
def delete_pipeline(session: SessionDep, pipeline_id: str) -> None:
    pipeline = get_pipeline_or_404(session, pipeline_id)
    pipeline.is_active = False
    pipeline.updated_at = datetime.now(timezone.utc)
    session.add(pipeline)


@router.post("/{pipeline_id}/validate", response_model=ValidatePipelineResponse)
def validate_pipeline(
    session: SessionDep, pipeline_id: str, body: ValidatePipelineRequest
) -> ValidatePipelineResponse:
    get_pipeline_or_404(session, pipeline_id)
    try:
        load_pipeline(body.config)
        return ValidatePipelineResponse(valid=True)
    except Exception as exc:
        return ValidatePipelineResponse(valid=False, error=str(exc))
