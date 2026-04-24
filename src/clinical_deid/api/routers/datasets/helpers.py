"""Shared helpers for the datasets sub-routers."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import HTTPException

from clinical_deid.api.routers.datasets.schemas import DatasetDetail, DatasetSummary
from clinical_deid.config import get_settings
from clinical_deid.dataset_store import DatasetInfo, public_data_path


def info_to_summary(info: DatasetInfo) -> DatasetSummary:
    return DatasetSummary(
        name=info.name,
        description=info.description,
        data_path=info.data_path,
        format=info.format,
        document_count=info.document_count,
        total_spans=info.total_spans,
        labels=info.labels,
        created_at=info.created_at,
    )


def manifest_to_detail(m: dict[str, Any]) -> DatasetDetail:
    root = get_settings().corpora_dir
    return DatasetDetail(
        name=m["name"],
        description=m.get("description", ""),
        data_path=public_data_path(root, m["name"], m),
        format=m["format"],
        document_count=m.get("document_count", 0),
        total_spans=m.get("total_spans", 0),
        labels=m.get("labels", []),
        created_at=m.get("created_at", ""),
        analytics=m.get("analytics", {}),
        metadata=m.get("metadata", {}),
        split_document_counts=m.get("split_document_counts", {}),
        has_split_metadata=m.get("has_split_metadata", False),
    )


def corpora_dir() -> Path:
    return get_settings().corpora_dir


def parse_splits_query(splits: str | None) -> list[str] | None:
    if not splits or not str(splits).strip():
        return None
    return [p.strip() for p in str(splits).split(",") if p.strip()]


def resolve_source_under_corpora(raw: str) -> Path:
    """Resolve a user-supplied source path, rejecting anything outside CORPORA_DIR."""
    corpora_root = corpora_dir().resolve()
    candidate = Path(raw)
    if candidate.is_absolute():
        resolved = candidate.resolve()
    else:
        resolved = (corpora_root / candidate).resolve()
    try:
        resolved.relative_to(corpora_root)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                f"source_path must stay under the corpora root ({corpora_root}); "
                f"got {raw!r}."
            ),
        ) from exc
    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"source_path not found: {raw!r}")
    return resolved


def surrogate_project_docs(docs: list[Any], *, seed: int | None) -> list[Any]:
    """Return a new list of ``AnnotatedDocument`` with surrogate text + aligned spans."""
    from clinical_deid.domain import AnnotatedDocument

    try:
        from clinical_deid.pipes.surrogate.align import surrogate_text_with_spans
    except ImportError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Surrogate export requires faker: {exc}",
        ) from exc

    offenders: list[str] = []
    projected: list[AnnotatedDocument] = []
    for d in docs:
        try:
            new_text, new_spans = surrogate_text_with_spans(
                d.document.text, list(d.spans), seed=seed
            )
        except ValueError:
            offenders.append(d.document.id)
            continue
        projected.append(
            AnnotatedDocument(
                document=d.document.model_copy(update={"text": new_text}),
                spans=new_spans,
            )
        )
    if offenders:
        raise HTTPException(
            status_code=422,
            detail=(
                "Overlapping spans prevent surrogate alignment for "
                f"{len(offenders)} document(s): {offenders[:10]}"
                + ("…" if len(offenders) > 10 else "")
            ),
        )
    return projected
