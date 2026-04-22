"""Filesystem-based dataset registry (colocated layout).

Each dataset named ``my-set`` lives in ``<corpora_dir>/my-set/``:

- ``dataset.json`` — manifest (analytics, metadata, format)
- ``corpus.jsonl`` — when ``format`` is ``jsonl``
- Or BRAT ``.txt`` / ``.ann`` (flat) / split subdirs when format is ``brat-dir`` / ``brat-corpus``

Registering **imports** a source path into that directory (copy). Compose / transform / generate
write ``corpus.jsonl`` inside the new home first, then call :func:`commit_colocated_dataset`.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from clinical_deid.analytics.stats import DatasetAnalytics, compute_dataset_analytics
from clinical_deid.domain import AnnotatedDocument
from clinical_deid.ingest.sources import load_annotated_corpus

logger = logging.getLogger(__name__)

DatasetFormat = Literal["jsonl", "brat-dir", "brat-corpus"]

DATASET_MANIFEST_NAME = "dataset.json"
CORPUS_JSONL_NAME = "corpus.jsonl"
MANIFEST_SCHEMA_COLOCATED = 2

_SAFE_NAME = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")

_BRAT_SPLIT_NAMES = frozenset({"train", "valid", "test", "dev", "deploy"})


def _validate_name(name: str) -> None:
    if not _SAFE_NAME.match(name) or ".." in name:
        raise ValueError(
            f"Invalid dataset name {name!r}: must match {_SAFE_NAME.pattern} "
            f"and not contain '..'"
        )


def _ensure_corpora_root(corpora_dir: Path) -> None:
    corpora_dir.mkdir(parents=True, exist_ok=True)


def dataset_home(corpora_dir: Path, name: str) -> Path:
    """Return ``corpora_dir / name`` (the dataset directory)."""
    _validate_name(name)
    return corpora_dir / name


def manifest_path(corpora_dir: Path, name: str) -> Path:
    return dataset_home(corpora_dir, name) / DATASET_MANIFEST_NAME


def corpus_data_path(home: Path, fmt: DatasetFormat) -> Path:
    """Filesystem path passed to :func:`load_annotated_corpus` (file for jsonl, dir for brat)."""
    if fmt == "jsonl":
        return home / CORPUS_JSONL_NAME
    return home


def _load_documents(data_path: str, fmt: DatasetFormat) -> list[AnnotatedDocument]:
    p = Path(data_path)
    fmt_map: dict[DatasetFormat, dict[str, Path]] = {
        "jsonl": {"jsonl": p},
        "brat-dir": {"brat_dir": p},
        "brat-corpus": {"brat_corpus": p},
    }
    return load_annotated_corpus(**fmt_map[fmt])


def _compute_summary(docs: list[AnnotatedDocument]) -> dict[str, Any]:
    analytics = compute_dataset_analytics(docs)
    return {
        "document_count": analytics.document_count,
        "total_spans": analytics.total_spans,
        "labels": sorted(analytics.label_counts.keys()),
        "analytics": json.loads(analytics.model_dump_json()),
    }


def _build_manifest(
    name: str,
    fmt: DatasetFormat,
    *,
    description: str,
    metadata: dict[str, Any],
    summary: dict[str, Any],
) -> dict[str, Any]:
    return {
        "name": name,
        "schema_version": MANIFEST_SCHEMA_COLOCATED,
        "layout": "colocated",
        "format": fmt,
        "description": description,
        "document_count": summary["document_count"],
        "total_spans": summary["total_spans"],
        "labels": summary["labels"],
        "analytics": summary["analytics"],
        "metadata": metadata,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Info struct
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DatasetInfo:
    """Summary of a registered dataset."""

    name: str
    path: Path  # manifest path (…/name/dataset.json)
    description: str
    data_path: str  # resolved path to corpus.jsonl or BRAT root (for API / CLI)
    format: DatasetFormat
    document_count: int
    total_spans: int
    labels: list[str]
    created_at: str
    metadata: dict[str, Any]


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


def _has_brat_pairs(directory: Path) -> bool:
    for txt in directory.glob("*.txt"):
        if txt.with_suffix(".ann").is_file():
            return True
    return False


def _looks_like_brat_split_corpus(d: Path) -> bool:
    for name in _BRAT_SPLIT_NAMES:
        sub = d / name
        if sub.is_dir() and _has_brat_pairs(sub):
            return True
    return False


def _suggest_dir_import(d: Path) -> tuple[Path, DatasetFormat] | None:
    """If *d* looks like an importable corpus tree, return source path and format."""
    corpus_jsonl = d / CORPUS_JSONL_NAME
    if corpus_jsonl.is_file():
        return corpus_jsonl, "jsonl"
    jsonl_files = sorted(d.glob("*.jsonl"))
    if len(jsonl_files) == 1:
        return jsonl_files[0], "jsonl"
    if len(jsonl_files) > 1:
        return None
    if _looks_like_brat_split_corpus(d):
        return d, "brat-corpus"
    if _has_brat_pairs(d):
        return d, "brat-dir"
    return None


def list_import_candidates(corpora_dir: Path) -> list[dict[str, Any]]:
    """Top-level files and folders under *corpora_dir* that can be passed to :func:`register_dataset`.

    Skips registered dataset homes (directories that already contain ``dataset.json``).
    """
    _ensure_corpora_root(corpora_dir)
    out: list[dict[str, Any]] = []
    for child in sorted(corpora_dir.iterdir(), key=lambda p: p.name.lower()):
        if child.name.startswith("."):
            continue
        if child.is_file():
            if child.suffix.lower() == ".jsonl":
                out.append(
                    {
                        "label": child.name,
                        "data_path": str(child.resolve()),
                        "suggested_format": "jsonl",
                    }
                )
            continue
        if not child.is_dir():
            continue
        if (child / DATASET_MANIFEST_NAME).is_file():
            continue
        suggested = _suggest_dir_import(child)
        if suggested is None:
            continue
        src_path, fmt = suggested
        if src_path.parent == child and src_path.is_file() and src_path.name != CORPUS_JSONL_NAME:
            label = f"{child.name}/{src_path.name}"
        else:
            label = child.name
        out.append(
            {
                "label": label,
                "data_path": str(src_path.resolve()),
                "suggested_format": fmt,
            }
        )
    return out


def list_datasets(corpora_dir: Path) -> list[DatasetInfo]:
    """Return all registered datasets (directories under *corpora_dir* with ``dataset.json``)."""
    _ensure_corpora_root(corpora_dir)
    results: list[DatasetInfo] = []
    for child in sorted(corpora_dir.iterdir(), key=lambda p: p.name.lower()):
        if not child.is_dir():
            continue
        mp = child / DATASET_MANIFEST_NAME
        if not mp.is_file():
            continue
        try:
            data = json.loads(mp.read_text(encoding="utf-8"))
            results.append(_manifest_to_info(corpora_dir, child.name, mp, data))
        except (json.JSONDecodeError, OSError, KeyError, ValueError):
            logger.warning("Skipping broken dataset manifest: %s", mp)
            continue
    return results


def load_dataset_manifest(corpora_dir: Path, name: str) -> dict[str, Any]:
    """Load the full manifest dict."""
    _validate_name(name)
    path = manifest_path(corpora_dir, name)
    if not path.is_file():
        available = _available_dataset_names(corpora_dir)
        raise FileNotFoundError(
            f"Dataset {name!r} not found under {corpora_dir}. "
            f"Available: {', '.join(sorted(available)) or '(none)'}"
        )
    return json.loads(path.read_text(encoding="utf-8"))


def _available_dataset_names(corpora_dir: Path) -> list[str]:
    if not corpora_dir.is_dir():
        return []
    out: list[str] = []
    for child in corpora_dir.iterdir():
        if child.is_dir() and (child / DATASET_MANIFEST_NAME).is_file():
            out.append(child.name)
    return out


def save_dataset_manifest(corpora_dir: Path, name: str, manifest: dict[str, Any]) -> Path:
    """Write ``dataset.json`` for *name*. Creates parent directory if needed."""
    _validate_name(name)
    home = dataset_home(corpora_dir, name)
    home.mkdir(parents=True, exist_ok=True)
    path = home / DATASET_MANIFEST_NAME
    path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return path


def delete_dataset(corpora_dir: Path, name: str) -> None:
    """Remove the dataset directory (manifest + corpus files)."""
    _validate_name(name)
    home = dataset_home(corpora_dir, name)
    if not home.is_dir() or not (home / DATASET_MANIFEST_NAME).is_file():
        raise FileNotFoundError(f"Dataset {name!r} not found under {corpora_dir}")
    shutil.rmtree(home)


# ---------------------------------------------------------------------------
# Import + commit
# ---------------------------------------------------------------------------


def _import_corpus_into_home(home: Path, source: Path, fmt: DatasetFormat) -> None:
    """Copy *source* corpus into *home* using the colocated layout."""
    src = source.resolve()
    if fmt == "jsonl":
        if not src.is_file():
            raise ValueError(f"JSONL source must be a file: {src}")
        shutil.copy2(src, home / CORPUS_JSONL_NAME)
        return
    if fmt == "brat-dir":
        if not src.is_dir():
            raise ValueError(f"BRAT directory source must be a directory: {src}")
        copied = 0
        for txt in sorted(src.glob("*.txt")):
            ann = txt.with_suffix(".ann")
            if ann.is_file():
                shutil.copy2(txt, home / txt.name)
                shutil.copy2(ann, home / ann.name)
                copied += 1
        if copied == 0:
            raise ValueError(f"No paired .txt/.ann files found under {src}")
        return
    if fmt == "brat-corpus":
        if not src.is_dir():
            raise ValueError(f"BRAT corpus root must be a directory: {src}")
        for entry in src.iterdir():
            if entry.name.startswith("."):
                continue
            if entry.is_dir():
                shutil.copytree(entry, home / entry.name, dirs_exist_ok=False)
            elif entry.is_file():
                shutil.copy2(entry, home / entry.name)
        return
    raise ValueError(f"Unknown format {fmt!r}")


def register_dataset(
    corpora_dir: Path,
    name: str,
    data_path: str,
    fmt: DatasetFormat,
    *,
    description: str = "",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Import *data_path* into ``corpora_dir/name/`` and write ``dataset.json``.

    Returns the full manifest dict.
    """
    _validate_name(name)
    _ensure_corpora_root(corpora_dir)
    home = dataset_home(corpora_dir, name)
    if home.exists():
        raise ValueError(
            f"Dataset directory already exists: {home}. "
            "Choose another name or remove the existing dataset."
        )
    home.mkdir(parents=True)
    try:
        _import_corpus_into_home(home, Path(data_path), fmt)
        rel = corpus_data_path(home, fmt)
        docs = _load_documents(str(rel.resolve()), fmt)
        if not docs:
            raise ValueError(f"No documents found after import into {home} (format={fmt})")
        summary = _compute_summary(docs)
        manifest = _build_manifest(
            name,
            fmt,
            description=description,
            metadata=metadata or {},
            summary=summary,
        )
        save_dataset_manifest(corpora_dir, name, manifest)
    except Exception:
        if home.is_dir():
            shutil.rmtree(home)
        raise
    return manifest


def commit_colocated_dataset(
    corpora_dir: Path,
    name: str,
    fmt: DatasetFormat,
    *,
    description: str = "",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Write ``dataset.json`` for a home that already contains corpus files."""
    _validate_name(name)
    home = dataset_home(corpora_dir, name)
    if not home.is_dir():
        raise FileNotFoundError(f"Dataset home not found: {home}")
    rel = corpus_data_path(home, fmt)
    if fmt == "jsonl" and not rel.is_file():
        raise ValueError(f"Missing {CORPUS_JSONL_NAME} in {home}")
    docs = _load_documents(str(rel.resolve()), fmt)
    if not docs:
        raise ValueError(f"No documents found in {home} (format={fmt})")
    summary = _compute_summary(docs)
    manifest = _build_manifest(
        name,
        fmt,
        description=description,
        metadata=metadata or {},
        summary=summary,
    )
    save_dataset_manifest(corpora_dir, name, manifest)
    return manifest


def refresh_analytics(corpora_dir: Path, name: str) -> dict[str, Any]:
    """Reload corpus from disk and update manifest analytics."""
    manifest = load_dataset_manifest(corpora_dir, name)
    fmt = manifest["format"]
    home = dataset_home(corpora_dir, name)
    rel = corpus_data_path(home, fmt)
    docs = _load_documents(str(rel.resolve()), fmt)
    summary = _compute_summary(docs)
    manifest.update(
        {
            "document_count": summary["document_count"],
            "total_spans": summary["total_spans"],
            "labels": summary["labels"],
            "analytics": summary["analytics"],
        }
    )
    save_dataset_manifest(corpora_dir, name, manifest)
    return manifest


def load_dataset_documents(corpora_dir: Path, name: str) -> list[AnnotatedDocument]:
    manifest = load_dataset_manifest(corpora_dir, name)
    fmt = manifest["format"]
    home = dataset_home(corpora_dir, name)
    rel = corpus_data_path(home, fmt)
    return _load_documents(str(rel.resolve()), fmt)


def public_data_path(corpora_dir: Path, name: str, manifest: dict[str, Any]) -> str:
    """Resolved corpus path for API responses (``data_path`` field)."""
    fmt = manifest["format"]
    home = dataset_home(corpora_dir, name)
    return str(corpus_data_path(home, fmt).resolve())


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _manifest_to_info(
    corpora_dir: Path, name: str, path: Path, data: dict[str, Any]
) -> DatasetInfo:
    if data.get("name") != name:
        raise ValueError(f"Manifest name mismatch: dir {name!r} vs manifest {data.get('name')!r}")
    fmt = data["format"]
    home = dataset_home(corpora_dir, name)
    return DatasetInfo(
        name=name,
        path=path,
        description=data.get("description", ""),
        data_path=str(corpus_data_path(home, fmt).resolve()),
        format=fmt,
        document_count=data.get("document_count", 0),
        total_spans=data.get("total_spans", 0),
        labels=data.get("labels", []),
        created_at=data.get("created_at", ""),
        metadata=data.get("metadata", {}),
    )
