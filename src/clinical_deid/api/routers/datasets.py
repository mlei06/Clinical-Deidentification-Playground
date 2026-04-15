"""Dataset HTTP API — register, browse, compose, transform, and generate datasets."""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from clinical_deid.config import get_settings
from clinical_deid.dataset_store import (
    DatasetFormat,
    DatasetInfo,
    delete_dataset,
    list_datasets,
    load_dataset_documents,
    load_dataset_manifest,
    refresh_analytics,
    register_dataset,
    save_dataset_manifest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/datasets", tags=["datasets"])


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


class RegisterDatasetRequest(BaseModel):
    name: str
    data_path: str
    format: DatasetFormat = "jsonl"
    description: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class UpdateDatasetRequest(BaseModel):
    description: str | None = None
    metadata: dict[str, Any] | None = None


class DocumentPreview(BaseModel):
    document_id: str
    text_preview: str
    span_count: int
    labels: list[str]


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
    """Apply transforms to a dataset and save as a new dataset."""

    source_dataset: str
    output_name: str
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
    return DatasetDetail(
        name=m["name"],
        description=m.get("description", ""),
        data_path=m["data_path"],
        format=m["format"],
        document_count=m.get("document_count", 0),
        total_spans=m.get("total_spans", 0),
        labels=m.get("labels", []),
        created_at=m.get("created_at", ""),
        analytics=m.get("analytics", {}),
        metadata=m.get("metadata", {}),
    )


def _datasets_dir():
    return get_settings().datasets_dir


# ---------------------------------------------------------------------------
# CRUD endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[DatasetSummary])
def list_all_datasets(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[DatasetSummary]:
    """List registered datasets."""
    datasets = list_datasets(_datasets_dir())
    datasets = datasets[offset : offset + limit]
    return [_info_to_summary(d) for d in datasets]


@router.post("", response_model=DatasetDetail, status_code=201)
def register_new_dataset(body: RegisterDatasetRequest) -> DatasetDetail:
    """Register a dataset from a local path — validates data, computes analytics."""
    ds_dir = _datasets_dir()

    # Check name not taken
    existing = [d.name for d in list_datasets(ds_dir)]
    if body.name in existing:
        raise HTTPException(status_code=409, detail=f"Dataset {body.name!r} already exists")

    try:
        manifest = register_dataset(
            ds_dir,
            body.name,
            body.data_path,
            body.format,
            description=body.description,
            metadata=body.metadata,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to register dataset: {exc}") from exc

    return _manifest_to_detail(manifest)


@router.get("/{name}", response_model=DatasetDetail)
def get_dataset(name: str) -> DatasetDetail:
    """Get full dataset metadata and analytics."""
    try:
        manifest = load_dataset_manifest(_datasets_dir(), name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _manifest_to_detail(manifest)


@router.put("/{name}", response_model=DatasetDetail)
def update_dataset(name: str, body: UpdateDatasetRequest) -> DatasetDetail:
    """Update description or metadata (does not re-scan data)."""
    ds_dir = _datasets_dir()
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
    """Unregister a dataset (does not delete the underlying data files)."""
    try:
        delete_dataset(_datasets_dir(), name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Analytics & preview
# ---------------------------------------------------------------------------


@router.post("/{name}/refresh", response_model=DatasetDetail)
def refresh_dataset_analytics(name: str) -> DatasetDetail:
    """Reload data from disk and recompute cached analytics."""
    try:
        manifest = refresh_analytics(_datasets_dir(), name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to refresh analytics: {exc}") from exc
    return _manifest_to_detail(manifest)


@router.get("/{name}/preview", response_model=list[DocumentPreview])
def preview_dataset(
    name: str,
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[DocumentPreview]:
    """Preview documents from a dataset (paginated)."""
    try:
        docs = load_dataset_documents(_datasets_dir(), name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load dataset: {exc}") from exc

    page = docs[offset : offset + limit]
    max_text = 500
    return [
        DocumentPreview(
            document_id=d.document.id,
            text_preview=d.document.text[:max_text] + ("..." if len(d.document.text) > max_text else ""),
            span_count=len(d.spans),
            labels=sorted(set(s.label for s in d.spans)),
        )
        for d in page
    ]


@router.get("/{name}/documents/{doc_id}")
def get_document(name: str, doc_id: str) -> dict[str, Any]:
    """Return a single document with full text and spans."""
    try:
        docs = load_dataset_documents(_datasets_dir(), name)
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


# ---------------------------------------------------------------------------
# Export endpoint
# ---------------------------------------------------------------------------


class ExportTrainingRequest(BaseModel):
    format: Literal["conll", "spacy", "huggingface"] = "conll"
    filename: str | None = None


class ExportTrainingResponse(BaseModel):
    path: str
    format: str
    document_count: int
    total_spans: int


@router.post("/{name}/export", response_model=ExportTrainingResponse, status_code=200)
def export_dataset(name: str, body: ExportTrainingRequest) -> ExportTrainingResponse:
    """Export a registered dataset to a training format (CoNLL, spaCy DocBin, HuggingFace JSONL).

    Writes the output file to the dataset directory.
    """
    from clinical_deid.training_export import export_training_data

    ds_dir = _datasets_dir()
    try:
        docs = load_dataset_documents(ds_dir, name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if not docs:
        raise HTTPException(status_code=422, detail=f"Dataset {name!r} has no documents")

    output_dir = ds_dir / f"{name}_export"
    try:
        path = export_training_data(
            docs, output_dir, body.format, filename=body.filename
        )
    except ImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    total_spans = sum(len(d.spans) for d in docs)
    return ExportTrainingResponse(
        path=str(path),
        format=body.format,
        document_count=len(docs),
        total_spans=total_spans,
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

    ds_dir = _datasets_dir()

    # Check output name not taken
    existing = [d.name for d in list_datasets(ds_dir)]
    if body.output_name in existing:
        raise HTTPException(status_code=409, detail=f"Dataset {body.output_name!r} already exists")

    # Load each source
    source_docs: list[list[Any]] = []
    for src_name in body.source_datasets:
        try:
            docs = load_dataset_documents(ds_dir, src_name)
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

    # Write JSONL to datasets dir
    output_path = ds_dir / f"{body.output_name}.data.jsonl"
    write_annotated_corpus(composed, jsonl=output_path)

    # Register
    provenance = {
        "composed_from": body.source_datasets,
        "strategy": body.strategy,
        "weights": body.weights,
        "target_documents": body.target_documents,
        "seed": body.seed,
        "shuffle": body.shuffle,
    }
    manifest = register_dataset(
        ds_dir,
        body.output_name,
        str(output_path),
        "jsonl",
        description=body.description or f"Composed from: {', '.join(body.source_datasets)}",
        metadata={"provenance": provenance},
    )
    return _manifest_to_detail(manifest)


# ---------------------------------------------------------------------------
# Transform endpoint
# ---------------------------------------------------------------------------


@router.post("/transform", response_model=DatasetDetail, status_code=201)
def transform_dataset(body: TransformRequest) -> DatasetDetail:
    """Apply transforms to a dataset and register the result.

    Available transforms (applied in order):
    1. **drop_labels** / **keep_labels** — filter spans by label
    2. **label_mapping** — rename labels (e.g. ``{"DOCTOR": "PERSON"}``)
    3. **target_documents** — resize corpus to exact document count
    4. **boost_label** + **boost_extra_copies** — oversample docs with a rare label
    5. **resplit** — reassign train/valid/test splits (e.g. ``{"train": 0.7, "valid": 0.15, "test": 0.15}``)
    6. **strip_splits** — remove split metadata for flat corpus
    """
    from clinical_deid.ingest.sink import write_annotated_corpus
    from clinical_deid.transform.ops import run_transform_pipeline

    ds_dir = _datasets_dir()

    # Check output name not taken
    existing = [d.name for d in list_datasets(ds_dir)]
    if body.output_name in existing:
        raise HTTPException(status_code=409, detail=f"Dataset {body.output_name!r} already exists")

    # Load source
    try:
        docs = load_dataset_documents(ds_dir, body.source_dataset)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Source dataset {body.source_dataset!r} not found")

    if not docs:
        raise HTTPException(status_code=422, detail=f"Source dataset {body.source_dataset!r} is empty")

    # Apply transforms
    transformed = run_transform_pipeline(
        docs,
        drop_labels=body.drop_labels,
        keep_labels=body.keep_labels,
        label_mapping=body.label_mapping,
        target_documents=body.target_documents,
        boost_label=body.boost_label,
        boost_extra_copies=body.boost_extra_copies,
        resplit=body.resplit,
        strip_splits=body.strip_splits,
        seed=body.seed,
    )

    if not transformed:
        raise HTTPException(status_code=422, detail="Transform produced no documents")

    # Write
    output_path = ds_dir / f"{body.output_name}.data.jsonl"
    write_annotated_corpus(transformed, jsonl=output_path)

    # Register
    provenance: dict[str, Any] = {"transformed_from": body.source_dataset}
    for field in (
        "drop_labels", "keep_labels", "label_mapping", "target_documents",
        "boost_label", "boost_extra_copies", "resplit", "strip_splits", "seed",
    ):
        val = getattr(body, field)
        if val and val != 0:
            provenance[field] = val

    manifest = register_dataset(
        ds_dir,
        body.output_name,
        str(output_path),
        "jsonl",
        description=body.description or f"Transformed from: {body.source_dataset}",
        metadata={"provenance": provenance},
    )
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

    ds_dir = _datasets_dir()
    settings = get_settings()

    # Check output name not taken
    existing = [d.name for d in list_datasets(ds_dir)]
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

    # Write
    output_path = ds_dir / f"{body.output_name}.data.jsonl"
    write_annotated_corpus(docs, jsonl=output_path)

    # Register
    provenance: dict[str, Any] = {
        "generated": True,
        "requested_count": body.count,
        "actual_count": len(docs),
        "phi_types": body.phi_types,
        "error_count": len(errors),
    }
    if errors:
        provenance["sample_errors"] = errors[:5]

    manifest = register_dataset(
        ds_dir,
        body.output_name,
        str(output_path),
        "jsonl",
        description=body.description or f"LLM-generated synthetic data ({len(docs)} notes)",
        metadata={"provenance": provenance},
    )
    return _manifest_to_detail(manifest)
