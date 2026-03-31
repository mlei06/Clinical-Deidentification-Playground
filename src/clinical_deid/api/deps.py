from __future__ import annotations

from collections.abc import Generator
from typing import Annotated

from fastapi import Depends, HTTPException
from sqlmodel import Session, select

from clinical_deid.db import get_engine
from clinical_deid.tables import PipelineRecord, PipelineVersionRecord


def session_dep() -> Generator[Session, None, None]:
    session = Session(get_engine())
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


SessionDep = Annotated[Session, Depends(session_dep)]


# ---------------------------------------------------------------------------
# Shared pipeline lookups (used by both pipelines and process routers)
# ---------------------------------------------------------------------------


def get_pipeline_or_404(session: Session, pipeline_id: str) -> PipelineRecord:
    """Fetch an active :class:`PipelineRecord` or raise 404."""
    rec = session.get(PipelineRecord, pipeline_id)
    if rec is None or not rec.is_active:
        raise HTTPException(status_code=404, detail="pipeline not found")
    return rec


def get_current_version(
    session: Session, pipeline: PipelineRecord
) -> PipelineVersionRecord:
    """Fetch the latest :class:`PipelineVersionRecord` for *pipeline*, or raise 500."""
    stmt = (
        select(PipelineVersionRecord)
        .where(PipelineVersionRecord.pipeline_id == pipeline.id)
        .where(PipelineVersionRecord.version == pipeline.latest_version)
    )
    ver = session.exec(stmt).first()
    if ver is None:
        raise HTTPException(status_code=500, detail="pipeline version record missing")
    return ver
