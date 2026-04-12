"""Filesystem-based dataset registry.

Each registered dataset is a JSON manifest in ``datasets/``.  A dataset named
``"i2b2-2014"`` lives at ``datasets/i2b2-2014.json`` and points to the actual
data (JSONL file or BRAT directory) via its ``data_path`` field.

The manifest caches summary analytics so listing datasets is cheap. Recompute
analytics explicitly when the underlying data changes.

No database, no versioning -- use git for history.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from clinical_deid.analytics.stats import DatasetAnalytics, compute_dataset_analytics
from clinical_deid.domain import AnnotatedDocument
from clinical_deid.ingest.sources import load_annotated_corpus

logger = logging.getLogger(__name__)

DatasetFormat = Literal["jsonl", "brat-dir", "brat-corpus"]

_SAFE_NAME = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")


def _validate_name(name: str) -> None:
    if not _SAFE_NAME.match(name) or ".." in name:
        raise ValueError(
            f"Invalid dataset name {name!r}: must match {_SAFE_NAME.pattern} "
            f"and not contain '..'"
        )


def _ensure_dir(datasets_dir: Path) -> None:
    datasets_dir.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Info struct
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DatasetInfo:
    """Summary of a registered dataset (read from manifest JSON)."""

    name: str
    path: Path  # manifest file path
    description: str
    data_path: str  # where the actual data lives
    format: DatasetFormat
    document_count: int
    total_spans: int
    labels: list[str]
    created_at: str
    metadata: dict[str, Any]


# ---------------------------------------------------------------------------
# Load helpers
# ---------------------------------------------------------------------------


def _load_documents(data_path: str, fmt: DatasetFormat) -> list[AnnotatedDocument]:
    """Load documents from the on-disk data path using the specified format."""
    p = Path(data_path)
    fmt_map: dict[DatasetFormat, dict[str, Path]] = {
        "jsonl": {"jsonl": p},
        "brat-dir": {"brat_dir": p},
        "brat-corpus": {"brat_corpus": p},
    }
    return load_annotated_corpus(**fmt_map[fmt])


def _compute_summary(docs: list[AnnotatedDocument]) -> dict[str, Any]:
    """Compute analytics and return a serialisable summary dict."""
    analytics = compute_dataset_analytics(docs)
    return {
        "document_count": analytics.document_count,
        "total_spans": analytics.total_spans,
        "labels": sorted(analytics.label_counts.keys()),
        "analytics": json.loads(analytics.model_dump_json()),
    }


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


def list_datasets(datasets_dir: Path) -> list[DatasetInfo]:
    """Return all registered datasets, sorted by name."""
    _ensure_dir(datasets_dir)
    results: list[DatasetInfo] = []
    for p in sorted(datasets_dir.glob("*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            results.append(_manifest_to_info(p, data))
        except (json.JSONDecodeError, OSError, KeyError):
            logger.warning("Skipping broken dataset manifest: %s", p)
            continue
    return results


def load_dataset_manifest(datasets_dir: Path, name: str) -> dict[str, Any]:
    """Load the full manifest dict. Raises ``FileNotFoundError`` if missing."""
    _validate_name(name)
    path = datasets_dir / f"{name}.json"
    if not path.is_file():
        available = [p.stem for p in datasets_dir.glob("*.json")]
        raise FileNotFoundError(
            f"Dataset {name!r} not found in {datasets_dir}. "
            f"Available: {', '.join(sorted(available)) or '(none)'}"
        )
    return json.loads(path.read_text(encoding="utf-8"))


def save_dataset_manifest(
    datasets_dir: Path,
    name: str,
    manifest: dict[str, Any],
) -> Path:
    """Write a dataset manifest. Returns the file path."""
    _validate_name(name)
    _ensure_dir(datasets_dir)
    path = datasets_dir / f"{name}.json"
    path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return path


def delete_dataset(datasets_dir: Path, name: str) -> None:
    """Delete a dataset manifest. Raises ``FileNotFoundError`` if missing."""
    _validate_name(name)
    path = datasets_dir / f"{name}.json"
    if not path.is_file():
        raise FileNotFoundError(f"Dataset {name!r} not found in {datasets_dir}")
    path.unlink()


# ---------------------------------------------------------------------------
# Registration (import + analytics)
# ---------------------------------------------------------------------------


def register_dataset(
    datasets_dir: Path,
    name: str,
    data_path: str,
    fmt: DatasetFormat,
    *,
    description: str = "",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Register a dataset: validate data, compute analytics, write manifest.

    Returns the full manifest dict.
    """
    _validate_name(name)
    docs = _load_documents(data_path, fmt)
    if not docs:
        raise ValueError(f"No documents found at {data_path!r} (format={fmt})")

    summary = _compute_summary(docs)
    manifest: dict[str, Any] = {
        "name": name,
        "description": description,
        "data_path": data_path,
        "format": fmt,
        "document_count": summary["document_count"],
        "total_spans": summary["total_spans"],
        "labels": summary["labels"],
        "analytics": summary["analytics"],
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    save_dataset_manifest(datasets_dir, name, manifest)
    return manifest


def refresh_analytics(datasets_dir: Path, name: str) -> dict[str, Any]:
    """Reload data, recompute analytics, update manifest. Returns updated manifest."""
    manifest = load_dataset_manifest(datasets_dir, name)
    docs = _load_documents(manifest["data_path"], manifest["format"])
    summary = _compute_summary(docs)
    manifest.update(
        document_count=summary["document_count"],
        total_spans=summary["total_spans"],
        labels=summary["labels"],
        analytics=summary["analytics"],
    )
    save_dataset_manifest(datasets_dir, name, manifest)
    return manifest


def load_dataset_documents(datasets_dir: Path, name: str) -> list[AnnotatedDocument]:
    """Load and return the actual documents for a registered dataset."""
    manifest = load_dataset_manifest(datasets_dir, name)
    return _load_documents(manifest["data_path"], manifest["format"])


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _manifest_to_info(path: Path, data: dict[str, Any]) -> DatasetInfo:
    return DatasetInfo(
        name=data["name"],
        path=path,
        description=data.get("description", ""),
        data_path=data["data_path"],
        format=data["format"],
        document_count=data.get("document_count", 0),
        total_spans=data.get("total_spans", 0),
        labels=data.get("labels", []),
        created_at=data.get("created_at", ""),
        metadata=data.get("metadata", {}),
    )
