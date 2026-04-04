"""Filesystem-based pipeline store.

Pipelines are JSON files in the ``pipelines/`` directory.  A pipeline named
``"production-deid"`` lives at ``pipelines/production-deid.json``.

No database, no versioning — use git for history.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class PipelineInfo:
    """Metadata for a discovered pipeline file."""

    name: str
    path: Path
    config: dict[str, Any]


def _ensure_dir(pipelines_dir: Path) -> None:
    pipelines_dir.mkdir(parents=True, exist_ok=True)


def list_pipelines(pipelines_dir: Path) -> list[PipelineInfo]:
    """Return all ``*.json`` pipelines in *pipelines_dir*, sorted by name."""
    _ensure_dir(pipelines_dir)
    results: list[PipelineInfo] = []
    for p in sorted(pipelines_dir.glob("*.json")):
        try:
            config = json.loads(p.read_text(encoding="utf-8"))
            results.append(PipelineInfo(name=p.stem, path=p, config=config))
        except (json.JSONDecodeError, OSError):
            continue  # skip broken files
    return results


def load_pipeline_config(pipelines_dir: Path, name: str) -> dict[str, Any]:
    """Load a pipeline config by name.  Raises ``FileNotFoundError`` if missing."""
    path = pipelines_dir / f"{name}.json"
    if not path.is_file():
        available = [p.stem for p in pipelines_dir.glob("*.json")]
        raise FileNotFoundError(
            f"Pipeline {name!r} not found in {pipelines_dir}. "
            f"Available: {', '.join(sorted(available)) or '(none)'}"
        )
    return json.loads(path.read_text(encoding="utf-8"))


def save_pipeline_config(
    pipelines_dir: Path,
    name: str,
    config: dict[str, Any],
) -> Path:
    """Write a pipeline config to ``pipelines/{name}.json``.  Returns the path."""
    _ensure_dir(pipelines_dir)
    path = pipelines_dir / f"{name}.json"
    path.write_text(
        json.dumps(config, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return path


def delete_pipeline(pipelines_dir: Path, name: str) -> None:
    """Delete a pipeline file.  Raises ``FileNotFoundError`` if missing."""
    path = pipelines_dir / f"{name}.json"
    if not path.is_file():
        raise FileNotFoundError(f"Pipeline {name!r} not found in {pipelines_dir}")
    path.unlink()
