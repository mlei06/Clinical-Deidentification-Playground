"""Dataset HTTP API — register, browse, compose, transform, and generate datasets."""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from clinical_deid.analytics.stats import DatasetAnalytics, compute_dataset_analytics
from clinical_deid.api.auth import require_admin
from clinical_deid.api.schemas import (
    IngestFromPipelineRequest,
    IngestFromPipelineResponse,
)
from clinical_deid.config import get_settings
from clinical_deid.dataset_store import (
    CORPUS_JSONL_NAME,
    DatasetFormat,
    DatasetInfo,
    commit_colocated_dataset,
    delete_dataset,
    import_brat_to_jsonl,
    import_jsonl_dataset,
    list_brat_import_candidates,
    list_datasets,
    list_import_candidates,
    load_dataset_documents,
    load_dataset_manifest,
    public_data_path,
    refresh_all_datasets,
    refresh_analytics,
    save_dataset_manifest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/datasets", tags=["datasets"], dependencies=[require_admin])


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class DatasetSummary(BaseModel):
    name: str
    description: str
    data_path: str
    format: DatasetFormat
    document_count: int
    total_spans: int
    labels: list[str]
    created_at: str


class DatasetDetail(DatasetSummary):
    analytics: dict[str, Any]
    metadata: dict[str, Any]
    split_document_counts: dict[str, int] = Field(
        default_factory=dict,
        description="Documents per metadata['split']; missing/invalid → '(none)'.",
    )
    has_split_metadata: bool = False


class RegisterDatasetRequest(BaseModel):
    name: str
    data_path: str
    format: DatasetFormat = "jsonl"
    description: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class ImportBratRequest(BaseModel):
    name: str
    brat_path: str
    description: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class ImportSourceCandidate(BaseModel):
    """A JSONL file or JSONL-in-folder that can be imported via ``POST /datasets``."""

    label: str
    data_path: str
    suggested_format: DatasetFormat


class ImportSourcesResponse(BaseModel):
    corpora_root: str
    candidates: list[ImportSourceCandidate]


class BratImportCandidate(BaseModel):
    """A directory under the corpora root that looks like a BRAT tree."""

    label: str
    data_path: str
    kind: Literal["brat-dir", "brat-corpus"]


class BratImportSourcesResponse(BaseModel):
    corpora_root: str
    candidates: list[BratImportCandidate]


class RefreshResultResponse(BaseModel):
    name: str
    status: Literal["ok", "error"]
    error: str | None = None


class UpdateDatasetRequest(BaseModel):
    description: str | None = None
    metadata: dict[str, Any] | None = None


class DocumentPreview(BaseModel):
    document_id: str
    text_preview: str
    span_count: int
    labels: list[str]
    split: str | None = None


class DatasetPreviewResponse(BaseModel):
    items: list[DocumentPreview]
    total: int


class ComposeRequest(BaseModel):
    """Compose multiple registered datasets into a new dataset."""

    output_name: str
    source_datasets: list[str] = Field(min_length=1)
    strategy: Literal["merge", "interleave", "proportional"] = "merge"
    weights: list[float] | None = None
    target_documents: int | None = None
    seed: int = 42
    shuffle: bool = False
    description: str = ""


class TransformRequest(BaseModel):
    """Apply transforms to a dataset and save as a new dataset.

    Output is written under ``$CORPORA_DIR/{output_name}/corpus.jsonl``. Use
    ``/datasets/{name}/export`` with ``format: "brat"`` to materialize BRAT for external tools.
    """

    source_dataset: str
    output_name: str = ""
    #: When True, overwrite the source dataset (``source_dataset``) in place. ``output_name`` is ignored.
    in_place: bool = False
    #: If set, only documents with ``metadata["split"]`` in this list are transformed.
    source_splits: list[str] | None = None
    drop_labels: list[str] | None = None
    keep_labels: list[str] | None = None
    label_mapping: dict[str, str] | None = None
    target_documents: int | None = None
    boost_label: str | None = None
    boost_extra_copies: int = 0
    resplit: dict[str, float] | None = None
    strip_splits: bool = False
    seed: int = 42
    description: str = ""
    transform_mode: Literal["full", "schema", "sampling", "partitioning"] = "full"
    #: If False, :func:`reassign_splits` uses stable document id order (no shuffle) before assignment.
    resplit_shuffle: bool = True
    #: Strip ``metadata['split']`` on targeted documents before re-partitioning (partitioning / full with resplit).
    flatten_target_splits: bool = False


class TransformPreviewRequest(BaseModel):
    """Dry-run the same transforms as ``TransformRequest`` (no write)."""

    source_dataset: str
    source_splits: list[str] | None = None
    drop_labels: list[str] | None = None
    keep_labels: list[str] | None = None
    label_mapping: dict[str, str] | None = None
    target_documents: int | None = None
    boost_label: str | None = None
    boost_extra_copies: int = 0
    resplit: dict[str, float] | None = None
    strip_splits: bool = False
    seed: int = 42
    transform_mode: Literal["full", "schema", "sampling", "partitioning"] = "full"
    resplit_shuffle: bool = True
    flatten_target_splits: bool = False


class DatasetLabelFrequency(BaseModel):
    label: str
    count: int


class DatasetSchemaResponse(BaseModel):
    """Unique span labels and counts for building transform UI controls."""

    dataset: str
    document_count: int
    total_spans: int
    labels: list[DatasetLabelFrequency]


class TransformPreviewResponse(BaseModel):
    """Summary counts for filter / mapping / projected corpus size."""

    source_document_count: int
    source_span_count: int
    spans_dropped_by_filter: int
    spans_kept_after_filter: int
    spans_renamed: int
    projected_document_count: int
    projected_span_count: int
    split_document_counts: dict[str, int] | None = None
    #: Documents not in ``source_splits`` (when that filter is set), left unchanged in the real transform.
    untouched_document_count: int = 0
    conflicts: list[str] = Field(default_factory=list)


class GenerateRequest(BaseModel):
    """Generate synthetic clinical notes via LLM and register as a dataset."""

    output_name: str
    count: int = Field(ge=1, le=500, default=10)
    phi_types: list[str] = Field(
        default_factory=lambda: ["PERSON", "DATE", "LOCATION", "ID", "PHONE", "AGE"],
    )
    special_rules: str = ""
    description: str = ""
    llm_kwargs: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _info_to_summary(info: DatasetInfo) -> DatasetSummary:
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


def _manifest_to_detail(m: dict[str, Any]) -> DatasetDetail:
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


def _corpora_dir():
    return get_settings().corpora_dir


def _parse_splits_query(splits: str | None) -> list[str] | None:
    if not splits or not str(splits).strip():
        return None
    return [p.strip() for p in str(splits).split(",") if p.strip()]


# ---------------------------------------------------------------------------
# CRUD endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[DatasetSummary])
def list_all_datasets(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[DatasetSummary]:
    """List registered datasets."""
    datasets = list_datasets(_corpora_dir())
    datasets = datasets[offset : offset + limit]
    return [_info_to_summary(d) for d in datasets]


@router.get("/import-sources", response_model=ImportSourcesResponse)
def list_dataset_import_sources() -> ImportSourcesResponse:
    """List JSONL files under the configured corpora root (BRAT candidates are separate)."""
    root = _corpora_dir().resolve()
    raw = list_import_candidates(root)
    return ImportSourcesResponse(
        corpora_root=str(root),
        candidates=[ImportSourceCandidate.model_validate(x) for x in raw],
    )


@router.get("/import-sources/brat", response_model=BratImportSourcesResponse)
def list_brat_dataset_import_sources() -> BratImportSourcesResponse:
    """List BRAT directories under the corpora root (candidates for ``POST /datasets/import/brat``)."""
    root = _corpora_dir().resolve()
    raw = list_brat_import_candidates(root)
    return BratImportSourcesResponse(
        corpora_root=str(root),
        candidates=[BratImportCandidate.model_validate(x) for x in raw],
    )


def _register_jsonl(body: RegisterDatasetRequest) -> DatasetDetail:
    ds_dir = _corpora_dir()

    if body.format != "jsonl":
        raise HTTPException(
            status_code=422,
            detail=(
                "Only format='jsonl' is supported via POST /datasets. "
                "Use POST /datasets/import/brat to convert a BRAT tree into a JSONL dataset."
            ),
        )

    existing = [d.name for d in list_datasets(ds_dir)]
    if body.name in existing:
        raise HTTPException(status_code=409, detail=f"Dataset {body.name!r} already exists")

    try:
        manifest = import_jsonl_dataset(
            ds_dir,
            body.name,
            body.data_path,
            description=body.description,
            metadata=body.metadata,
        )
    except ValueError as exc:
        msg = str(exc)
        if "already exists" in msg:
            raise HTTPException(status_code=409, detail=msg) from exc
        raise HTTPException(status_code=422, detail=msg) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to register dataset: {exc}") from exc

    return _manifest_to_detail(manifest)


@router.post("", response_model=DatasetDetail, status_code=201)
def register_new_dataset(body: RegisterDatasetRequest) -> DatasetDetail:
    """Import a JSONL corpus into a new dataset home and compute analytics."""
    return _register_jsonl(body)


@router.post("/import/jsonl", response_model=DatasetDetail, status_code=201)
def import_jsonl_dataset_route(body: RegisterDatasetRequest) -> DatasetDetail:
    """Alias of ``POST /datasets`` — explicit name for the JSONL import path."""
    return _register_jsonl(body)


@router.post("/import/brat", response_model=DatasetDetail, status_code=201)
def import_brat_dataset_route(body: ImportBratRequest) -> DatasetDetail:
    """Convert a BRAT tree (flat or split) into a new JSONL dataset home."""
    from pathlib import Path

    ds_dir = _corpora_dir()

    existing = [d.name for d in list_datasets(ds_dir)]
    if body.name in existing:
        raise HTTPException(status_code=409, detail=f"Dataset {body.name!r} already exists")

    try:
        manifest = import_brat_to_jsonl(
            ds_dir,
            body.name,
            Path(body.brat_path),
            description=body.description,
            metadata=body.metadata,
        )
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to import BRAT: {exc}") from exc

    return _manifest_to_detail(manifest)


@router.post("/refresh-all", response_model=list[RefreshResultResponse])
def refresh_all_datasets_route() -> list[RefreshResultResponse]:
    """Refresh analytics for every discovered dataset; per-home errors are surfaced inline."""
    results = refresh_all_datasets(_corpora_dir())
    return [
        RefreshResultResponse(name=r.name, status=r.status, error=r.error) for r in results
    ]


def _resolve_source_under_corpora(raw: str) -> "Path":
    """Resolve a user-supplied source path, rejecting anything outside CORPORA_DIR."""
    from pathlib import Path

    corpora_root = _corpora_dir().resolve()
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


@router.post(
    "/ingest-from-pipeline",
    response_model=IngestFromPipelineResponse,
    status_code=201,
)
def ingest_from_pipeline(body: IngestFromPipelineRequest) -> IngestFromPipelineResponse:
    """Run a saved pipeline over raw text under the corpora root and register the result."""
    from clinical_deid.audit import log_run
    from clinical_deid.ingest.from_batch import ingest_paths_with_pipeline
    from clinical_deid.ingest.sink import write_annotated_corpus
    import time as _time

    ds_dir = _corpora_dir()

    existing = [d.name for d in list_datasets(ds_dir)]
    if body.output_name in existing:
        raise HTTPException(
            status_code=409, detail=f"Dataset {body.output_name!r} already exists"
        )

    resolved = _resolve_source_under_corpora(body.source_path)

    t0 = _time.perf_counter()
    docs: list[Any] = []
    try:
        for doc in ingest_paths_with_pipeline(
            [resolved], pipeline_name=body.pipeline_name
        ):
            docs.append(doc)
            if len(docs) > body.max_documents:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"source_path produced more than max_documents={body.max_documents} "
                        "documents; narrow the source or raise the cap."
                    ),
                )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    duration = _time.perf_counter() - t0

    if not docs:
        raise HTTPException(
            status_code=422,
            detail=f"No documents produced from {body.source_path!r}",
        )

    home = ds_dir / body.output_name
    home.mkdir(parents=True)
    try:
        write_annotated_corpus(docs, jsonl=home / CORPUS_JSONL_NAME)
        manifest = commit_colocated_dataset(
            ds_dir,
            body.output_name,
            "jsonl",
            description=body.description or f"Ingested via pipeline {body.pipeline_name!r}",
            metadata={
                "provenance": {
                    "ingested_from": str(resolved),
                    "pipeline_name": body.pipeline_name,
                }
            },
        )
    except Exception:
        import shutil
        if home.is_dir():
            shutil.rmtree(home)
        raise

    total_spans = sum(len(d.spans) for d in docs)
    try:
        log_run(
            command="dataset_ingest",
            pipeline_name=body.pipeline_name,
            dataset_source=str(resolved),
            doc_count=len(docs),
            error_count=0,
            span_count=total_spans,
            duration_seconds=duration,
            source="api-admin",
        )
    except Exception:
        logger.warning("Failed to write audit record", exc_info=True)

    return IngestFromPipelineResponse(
        name=manifest["name"],
        document_count=int(manifest.get("document_count", len(docs))),
        total_spans=int(manifest.get("total_spans", total_spans)),
    )


@router.get("/{name}", response_model=DatasetDetail)
def get_dataset(name: str) -> DatasetDetail:
    """Get full dataset metadata and analytics."""
    try:
        manifest = load_dataset_manifest(_corpora_dir(), name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if manifest.get("format") != "jsonl":
        raise HTTPException(
            status_code=404,
            detail=(
                f"Dataset {name!r} uses a legacy on-disk format. "
                "Re-import as JSONL (e.g. POST /datasets/import/brat) or remove the directory."
            ),
        )
    return _manifest_to_detail(manifest)


@router.put("/{name}", response_model=DatasetDetail)
def update_dataset(name: str, body: UpdateDatasetRequest) -> DatasetDetail:
    """Update description or metadata (does not re-scan data)."""
    ds_dir = _corpora_dir()
    try:
        manifest = load_dataset_manifest(ds_dir, name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if body.description is not None:
        manifest["description"] = body.description
    if body.metadata is not None:
        manifest["metadata"] = body.metadata

    save_dataset_manifest(ds_dir, name, manifest)
    return _manifest_to_detail(manifest)


@router.delete("/{name}", status_code=204)
def remove_dataset(name: str) -> None:
    """Delete the dataset directory (manifest and corpus files under ``corpora_dir/name/``)."""
    try:
        delete_dataset(_corpora_dir(), name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Analytics & preview
# ---------------------------------------------------------------------------


@router.get("/{name}/schema", response_model=DatasetSchemaResponse)
def get_dataset_schema(name: str) -> DatasetSchemaResponse:
    """Return label frequencies for schema discovery (dropdowns, chips).

    Uses cached manifest analytics when available; otherwise loads documents once
    to compute ``label_counts``.
    """
    ds_dir = _corpora_dir()
    try:
        manifest = load_dataset_manifest(ds_dir, name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    analytics_blob = manifest.get("analytics") or {}
    label_counts: dict[str, int] = dict(analytics_blob.get("label_counts") or {})
    if not label_counts and manifest.get("total_spans", 0) > 0:
        try:
            docs = load_dataset_documents(ds_dir, name)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to load dataset for schema: {exc}",
            ) from exc
        label_counts = dict(compute_dataset_analytics(docs).label_counts)

    ordered = sorted(label_counts.items(), key=lambda x: (-x[1], x[0]))
    labels = [DatasetLabelFrequency(label=k, count=v) for k, v in ordered]
    return DatasetSchemaResponse(
        dataset=name,
        document_count=int(manifest.get("document_count", 0)),
        total_spans=int(manifest.get("total_spans", 0)),
        labels=labels,
    )


@router.post("/{name}/refresh", response_model=DatasetDetail)
def refresh_dataset_analytics(name: str) -> DatasetDetail:
    """Reload data from disk and recompute cached analytics."""
    try:
        manifest = refresh_analytics(_corpora_dir(), name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to refresh analytics: {exc}") from exc
    return _manifest_to_detail(manifest)


@router.get("/{name}/analytics", response_model=DatasetAnalytics)
def get_dataset_subset_analytics(
    name: str,
    split: str | None = Query(
        default=None,
        description="Omit for whole-corpus stats. A split name, or (none) for documents without split.",
    ),
) -> DatasetAnalytics:
    """Recompute dataset-level analytics for the whole corpus or one split bucket."""
    from clinical_deid.transform.ops import filter_documents_by_split_query

    try:
        docs = load_dataset_documents(_corpora_dir(), name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if split is not None and str(split).strip() != "":
        docs = filter_documents_by_split_query(docs, [str(split).strip()])
    return compute_dataset_analytics(docs)


@router.get("/{name}/preview", response_model=DatasetPreviewResponse)
def preview_dataset(
    name: str,
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    splits: str | None = Query(
        default=None,
        description="Comma-separated split names; omit for all. Use (none) for documents without split.",
    ),
) -> DatasetPreviewResponse:
    """Preview documents from a dataset (paginated, optional split filter)."""
    from clinical_deid.transform.ops import filter_documents_by_split_query

    try:
        docs = load_dataset_documents(_corpora_dir(), name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load dataset: {exc}") from exc

    wanted = _parse_splits_query(splits)
    filtered = filter_documents_by_split_query(docs, wanted)
    total = len(filtered)
    page = filtered[offset : offset + limit]
    max_text = 500
    items: list[DocumentPreview] = []
    for d in page:
        sp = d.document.metadata.get("split")
        split_out = sp.strip() if isinstance(sp, str) and sp.strip() else None
        items.append(
            DocumentPreview(
                document_id=d.document.id,
                text_preview=d.document.text[:max_text] + ("..." if len(d.document.text) > max_text else ""),
                span_count=len(d.spans),
                labels=sorted(set(s.label for s in d.spans)),
                split=split_out,
            )
        )
    return DatasetPreviewResponse(items=items, total=total)


@router.get("/{name}/documents/{doc_id}")
def get_document(name: str, doc_id: str) -> dict[str, Any]:
    """Return a single document with full text and spans."""
    try:
        docs = load_dataset_documents(_corpora_dir(), name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    for d in docs:
        if d.document.id == doc_id:
            return {
                "document_id": d.document.id,
                "text": d.document.text,
                "metadata": d.document.metadata,
                "spans": [s.model_dump() for s in d.spans],
            }
    raise HTTPException(status_code=404, detail=f"Document {doc_id!r} not found in dataset {name!r}")


class UpdateDocumentRequest(BaseModel):
    """Replace a document's spans (and optionally its text).

    Concurrency: v1 is last-write-wins; two concurrent ``PUT``s for the same
    ``doc_id`` can race. Add an ETag / revision field if stricter semantics become
    necessary.
    """

    spans: list[dict[str, Any]] = Field(default_factory=list)
    text: str | None = None


class UpdateDocumentResponse(BaseModel):
    document_id: str
    text: str
    metadata: dict[str, Any]
    spans: list[dict[str, Any]]


@router.put(
    "/{name}/documents/{doc_id}",
    response_model=UpdateDocumentResponse,
)
def update_document_route(
    name: str, doc_id: str, body: UpdateDocumentRequest
) -> UpdateDocumentResponse:
    """Replace a document's spans (and optionally text). Rewrites ``corpus.jsonl`` atomically."""
    from clinical_deid.dataset_store import update_document as store_update_document

    try:
        updated = store_update_document(
            _corpora_dir(),
            name,
            doc_id,
            spans=body.spans,
            text=body.text,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail=f"Document {doc_id!r} not found in dataset {name!r}",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return UpdateDocumentResponse(
        document_id=updated.document.id,
        text=updated.document.text,
        metadata=updated.document.metadata,
        spans=[s.model_dump() for s in updated.spans],
    )


# ---------------------------------------------------------------------------
# Export endpoint
# ---------------------------------------------------------------------------


class ExportTrainingRequest(BaseModel):
    format: Literal["conll", "spacy", "huggingface", "brat", "jsonl"] = "conll"
    filename: str | None = None
    target_text: Literal["original", "surrogate"] = Field(
        default="original",
        description=(
            "When 'surrogate', run surrogate alignment on each doc before exporting "
            "(text and spans both point at the surrogate)."
        ),
    )
    surrogate_seed: int | None = None


class ExportTrainingResponse(BaseModel):
    path: str
    format: str
    document_count: int
    total_spans: int
    target_text: Literal["original", "surrogate"] = "original"


def _surrogate_project_docs(
    docs: list[Any], *, seed: int | None
) -> list[Any]:
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


@router.post("/{name}/export", response_model=ExportTrainingResponse, status_code=200)
def export_dataset(name: str, body: ExportTrainingRequest) -> ExportTrainingResponse:
    """Export a registered dataset to a downstream format.

    - ``conll`` / ``spacy`` / ``huggingface`` / ``jsonl``: training / annotated formats
    - ``brat``: flat BRAT folder of ``.txt`` / ``.ann`` pairs (for external tools)

    Output goes under ``$EXPORTS_DIR/{name}/`` — kept out of ``$CORPORA_DIR`` so the
    corpora root stays canonical (JSONL only).

    Pass ``target_text="surrogate"`` to write surrogate-aligned text/spans instead
    of the original corpus text. Set ``surrogate_seed`` for determinism.
    """
    from clinical_deid.ingest.sink import write_annotated_corpus
    from clinical_deid.training_export import export_training_data

    ds_dir = _corpora_dir()
    try:
        docs = load_dataset_documents(ds_dir, name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if not docs:
        raise HTTPException(status_code=422, detail=f"Dataset {name!r} has no documents")

    if body.target_text == "surrogate":
        docs = _surrogate_project_docs(docs, seed=body.surrogate_seed)

    output_dir = get_settings().exports_dir / name
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        if body.format == "brat":
            write_annotated_corpus(docs, brat_dir=output_dir)
            path: Any = output_dir
        else:
            path = export_training_data(docs, output_dir, body.format, filename=body.filename)
    except ImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    total_spans = sum(len(d.spans) for d in docs)
    return ExportTrainingResponse(
        path=str(path),
        format=body.format,
        document_count=len(docs),
        total_spans=total_spans,
        target_text=body.target_text,
    )


# ---------------------------------------------------------------------------
# Compose endpoint
# ---------------------------------------------------------------------------


@router.post("/compose", response_model=DatasetDetail, status_code=201)
def compose_datasets(body: ComposeRequest) -> DatasetDetail:
    """Compose multiple datasets into a new registered dataset.

    Strategies:
    - **merge**: concatenate in order
    - **interleave**: round-robin across sources
    - **proportional**: weighted sampling (requires ``weights``)
    """
    from clinical_deid.compose.pipeline import compose_corpora
    from clinical_deid.ingest.sink import write_annotated_corpus

    corp = _corpora_dir()

    # Check output name not taken
    existing = [d.name for d in list_datasets(corp)]
    if body.output_name in existing:
        raise HTTPException(status_code=409, detail=f"Dataset {body.output_name!r} already exists")

    # Load each source
    source_docs: list[list[Any]] = []
    for src_name in body.source_datasets:
        try:
            docs = load_dataset_documents(corp, src_name)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail=f"Source dataset {src_name!r} not found")
        if not docs:
            raise HTTPException(status_code=422, detail=f"Source dataset {src_name!r} is empty")
        source_docs.append(docs)

    # Validate weights
    if body.strategy == "proportional" and body.weights:
        if len(body.weights) != len(body.source_datasets):
            raise HTTPException(
                status_code=422,
                detail=f"weights length ({len(body.weights)}) must match source_datasets length ({len(body.source_datasets)})",
            )

    # Compose
    composed = compose_corpora(
        source_docs,
        strategy=body.strategy,
        weights=body.weights,
        target_documents=body.target_documents,
        seed=body.seed,
        shuffle=body.shuffle,
    )

    if not composed:
        raise HTTPException(status_code=422, detail="Composition produced no documents")

    settings = get_settings()
    home = settings.corpora_dir / body.output_name
    home.mkdir(parents=True)
    output_path = home / CORPUS_JSONL_NAME
    write_annotated_corpus(composed, jsonl=output_path)

    provenance = {
        "composed_from": body.source_datasets,
        "strategy": body.strategy,
        "weights": body.weights,
        "target_documents": body.target_documents,
        "seed": body.seed,
        "shuffle": body.shuffle,
    }
    manifest = commit_colocated_dataset(
        settings.corpora_dir,
        body.output_name,
        "jsonl",
        description=body.description or f"Composed from: {', '.join(body.source_datasets)}",
        metadata={"provenance": provenance},
    )
    return _manifest_to_detail(manifest)


# ---------------------------------------------------------------------------
# Transform endpoint
# ---------------------------------------------------------------------------


@router.post("/transform/preview", response_model=TransformPreviewResponse)
def preview_transform_dataset(body: TransformPreviewRequest) -> TransformPreviewResponse:
    """Dry-run transform: span keep/drop/rename counts and projected corpus size."""
    from clinical_deid.transform.ops import compute_transform_preview, get_work_and_rest

    corp = _corpora_dir()
    try:
        all_docs = load_dataset_documents(corp, body.source_dataset)
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Source dataset {body.source_dataset!r} not found",
        ) from None
    if not all_docs:
        raise HTTPException(
            status_code=422,
            detail=f"Source dataset {body.source_dataset!r} is empty",
        )

    work, rest = get_work_and_rest(all_docs, body.source_splits)
    if body.source_splits and any(str(s).strip() for s in body.source_splits) and not work:
        raise HTTPException(
            status_code=422,
            detail=(
                f"No documents match source_splits for dataset {body.source_dataset!r}; "
                "set metadata['split'] on documents or adjust the filter."
            ),
        )

    try:
        raw = compute_transform_preview(
            work,
            drop_labels=body.drop_labels,
            keep_labels=body.keep_labels,
            label_mapping=body.label_mapping,
            target_documents=body.target_documents,
            boost_label=body.boost_label,
            boost_extra_copies=body.boost_extra_copies,
            resplit=body.resplit,
            strip_splits=body.strip_splits,
            seed=body.seed,
            transform_mode=body.transform_mode,
            resplit_shuffle=body.resplit_shuffle,
            flatten_before_resplit=body.flatten_target_splits,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    n_rest = len(rest)
    raw["untouched_document_count"] = n_rest
    raw["projected_document_count"] = int(raw["projected_document_count"]) + n_rest
    return TransformPreviewResponse(**raw)


@router.post("/transform", response_model=DatasetDetail, status_code=201)
def transform_dataset(
    body: TransformRequest, response: Response
) -> DatasetDetail:
    """Apply transforms to a dataset and register the result (new dataset) or update in place.

    Available transforms (applied in order):
    1. **drop_labels** / **keep_labels** — filter spans by label
    2. **label_mapping** — rename labels (e.g. ``{"DOCTOR": "PERSON"}``)
    3. **target_documents** — resize corpus to exact document count
    4. **boost_label** + **boost_extra_copies** — oversample docs with a rare label
    5. **resplit** — reassign train/valid/test splits (e.g. ``{"train": 0.7, "valid": 0.15, "test": 0.15}``)
    6. **strip_splits** — remove split metadata for flat corpus

    Set **in_place** to true to write back to the source dataset (same name and path); new datasets require a unique
    **output_name** when in_place is false.
    """
    from clinical_deid.ingest.sink import write_annotated_corpus
    from clinical_deid.transform.ops import get_work_and_rest, merge_rest_work, run_transform_by_mode

    corp = _corpora_dir()

    if not body.in_place and not (body.output_name and str(body.output_name).strip()):
        raise HTTPException(
            status_code=422,
            detail="output_name is required when not transforming in place",
        )
    out_name = body.source_dataset if body.in_place else str(body.output_name).strip()
    if not out_name and body.in_place:
        raise HTTPException(status_code=422, detail="source_dataset is required for in-place transform")

    # Check output name not taken (new dataset only)
    existing = [d.name for d in list_datasets(corp)]
    if not body.in_place and out_name in existing:
        raise HTTPException(status_code=409, detail=f"Dataset {out_name!r} already exists")

    # Load source
    try:
        all_docs = load_dataset_documents(corp, body.source_dataset)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Source dataset {body.source_dataset!r} not found")

    if not all_docs:
        raise HTTPException(status_code=422, detail=f"Source dataset {body.source_dataset!r} is empty")

    work, rest = get_work_and_rest(all_docs, body.source_splits)
    if body.source_splits and any(str(s).strip() for s in body.source_splits) and not work:
        raise HTTPException(
            status_code=422,
            detail=(
                f"No documents match source_splits for dataset {body.source_dataset!r}; "
                "set metadata['split'] on documents or adjust the filter."
            ),
        )

    try:
        work_out = run_transform_by_mode(
            work,
            body.transform_mode,
            drop_labels=body.drop_labels,
            keep_labels=body.keep_labels,
            label_mapping=body.label_mapping,
            target_documents=body.target_documents,
            boost_label=body.boost_label,
            boost_extra_copies=body.boost_extra_copies,
            resplit=body.resplit,
            strip_splits=body.strip_splits,
            seed=body.seed,
            resplit_shuffle=body.resplit_shuffle,
            flatten_before_resplit=body.flatten_target_splits,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    transformed = merge_rest_work(rest, work_out)

    if not transformed:
        raise HTTPException(status_code=422, detail="Transform produced no documents")

    settings = get_settings()
    home = settings.corpora_dir / out_name
    if not body.in_place:
        home.mkdir(parents=True)
    else:
        if not home.is_dir() or not (home / CORPUS_JSONL_NAME).is_file():
            raise HTTPException(
                status_code=404,
                detail=f"Cannot transform in place: dataset {out_name!r} has no corpus on disk",
            )
    output_path = home / CORPUS_JSONL_NAME
    write_annotated_corpus(transformed, jsonl=output_path)

    transform_provenance: dict[str, Any] = {"transformed_from": body.source_dataset}
    for field in (
        "source_splits",
        "drop_labels", "keep_labels", "label_mapping", "target_documents",
        "boost_label", "boost_extra_copies", "resplit", "strip_splits", "seed",
    ):
        val = getattr(body, field)
        if val and val != 0:
            transform_provenance[field] = val
    if body.transform_mode != "full":
        transform_provenance["transform_mode"] = body.transform_mode
    if not body.resplit_shuffle:
        transform_provenance["resplit_shuffle"] = False
    if body.flatten_target_splits:
        transform_provenance["flatten_target_splits"] = True
    transform_provenance["in_place"] = body.in_place

    if body.in_place:
        existing = load_dataset_manifest(corp, out_name)
        old_desc = (existing.get("description") or "") if isinstance(existing, dict) else ""
        if body.description and str(body.description).strip():
            desc = str(body.description).strip()
        else:
            desc = old_desc
        old_meta: dict[str, Any] = {}
        if isinstance(existing, dict) and existing.get("metadata") and isinstance(
            existing.get("metadata"), dict
        ):
            old_meta = dict(existing["metadata"])
        old_prov = old_meta.get("provenance")
        if not isinstance(old_prov, dict):
            old_prov = {}
        new_meta: dict[str, Any] = {
            **old_meta,
            "provenance": {**old_prov, "last_transform": transform_provenance, "transformed_in_place": True},
        }
        manifest = commit_colocated_dataset(
            settings.corpora_dir,
            out_name,
            "jsonl",
            description=desc,
            metadata=new_meta,
        )
        response.status_code = 200
    else:
        manifest = commit_colocated_dataset(
            settings.corpora_dir,
            out_name,
            "jsonl",
            description=body.description or f"Transformed from: {body.source_dataset}",
            metadata={"provenance": transform_provenance},
        )
        response.status_code = 201
    return _manifest_to_detail(manifest)


# ---------------------------------------------------------------------------
# Generate endpoint
# ---------------------------------------------------------------------------


@router.post("/generate", response_model=DatasetDetail, status_code=201)
def generate_dataset(body: GenerateRequest) -> DatasetDetail:
    """Generate synthetic annotated clinical notes via LLM and register as a dataset.

    Uses the configured OpenAI-compatible endpoint (see ``OPENAI_API_KEY`` / settings).
    Each generated note is aligned to produce character-level PHI spans.
    """
    from clinical_deid.ingest.sink import write_annotated_corpus
    from clinical_deid.synthesis.document import synthesis_result_to_annotated_document
    from clinical_deid.synthesis.synthesizer import LLMSynthesizer
    from clinical_deid.synthesis.types import FewShotExample

    corp = _corpora_dir()
    settings = get_settings()

    # Check output name not taken
    existing = [d.name for d in list_datasets(corp)]
    if body.output_name in existing:
        raise HTTPException(status_code=409, detail=f"Dataset {body.output_name!r} already exists")

    # Build LLM client
    try:
        llm = settings.openai_chat_client()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Build synthesizer (no few-shot examples by default — LLM uses its own knowledge)
    synthesizer = LLMSynthesizer(
        llm=llm,
        phi_types=body.phi_types,
        examples=[],
        special_rules=body.special_rules,
    )

    # Generate documents
    docs = []
    errors = []
    for i in range(body.count):
        doc_id = f"synth_{i + 1:04d}"
        try:
            result = synthesizer.generate_one(**body.llm_kwargs)
            ad = synthesis_result_to_annotated_document(
                result,
                document_id=doc_id,
                metadata={"source": "llm_synthesis", "index": i},
            )
            docs.append(ad)
        except Exception as exc:
            logger.warning("Generation failed for doc %s: %s", doc_id, exc)
            errors.append({"doc_id": doc_id, "error": str(exc)})

    if not docs:
        raise HTTPException(
            status_code=500,
            detail=f"All {body.count} generation attempts failed. Errors: {errors[:5]}",
        )

    home = settings.corpora_dir / body.output_name
    home.mkdir(parents=True)
    output_path = home / CORPUS_JSONL_NAME
    write_annotated_corpus(docs, jsonl=output_path)

    provenance: dict[str, Any] = {
        "generated": True,
        "requested_count": body.count,
        "actual_count": len(docs),
        "phi_types": body.phi_types,
        "error_count": len(errors),
    }
    if errors:
        provenance["sample_errors"] = errors[:5]

    manifest = commit_colocated_dataset(
        settings.corpora_dir,
        body.output_name,
        "jsonl",
        description=body.description or f"LLM-generated synthetic data ({len(docs)} notes)",
        metadata={"provenance": provenance},
    )
    return _manifest_to_detail(manifest)
