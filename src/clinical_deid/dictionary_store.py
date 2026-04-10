"""Filesystem-backed dictionary store for whitelist and blacklist term lists.

Layout::

    dictionaries/
      whitelist/
        HOSPITAL/
          ontario_hospitals.txt
          us_hospitals.csv
        DOCTOR/
          staff_list.txt
      blacklist/
        clinical_terms.txt
        custom_safe_words.txt

Whitelist dictionaries are organized by label (subdirectory per label).
Blacklist dictionaries are flat files in the ``blacklist/`` directory.

Pipeline configs reference dictionaries by name (stem, without extension)
and the store resolves them to file paths.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from clinical_deid.pipes.whitelist.lists import parse_list_file

DictKind = Literal["whitelist", "blacklist"]


@dataclass(frozen=True)
class DictionaryInfo:
    """Metadata for a stored dictionary file."""

    kind: DictKind
    label: str | None  # None for blacklist (no label subdirectory)
    name: str  # file stem
    filename: str  # full filename with extension
    term_count: int


class DictionaryStore:
    """CRUD operations on the ``dictionaries/`` folder."""

    def __init__(self, root: Path) -> None:
        self._root = root

    @property
    def root(self) -> Path:
        return self._root

    # -- paths ---------------------------------------------------------------

    def _whitelist_dir(self, label: str) -> Path:
        return self._root / "whitelist" / label.upper()

    def _blacklist_dir(self) -> Path:
        return self._root / "blacklist"

    def _resolve_path(self, kind: DictKind, name: str, label: str | None) -> Path | None:
        """Find a dictionary file by name (stem). Returns None if not found."""
        if kind == "whitelist":
            if label is None:
                return None
            parent = self._whitelist_dir(label)
        else:
            parent = self._blacklist_dir()
        if not parent.is_dir():
            return None
        for p in parent.iterdir():
            if p.is_file() and p.stem == name:
                return p
        return None

    # -- list ----------------------------------------------------------------

    def list_dictionaries(
        self,
        kind: DictKind | None = None,
        label: str | None = None,
    ) -> list[DictionaryInfo]:
        """List stored dictionaries, optionally filtered by kind and/or label."""
        results: list[DictionaryInfo] = []
        if kind is None or kind == "whitelist":
            results.extend(self._list_whitelist(label))
        if kind is None or kind == "blacklist":
            if label is None:
                results.extend(self._list_blacklist())
        return results

    def _list_whitelist(self, label_filter: str | None = None) -> list[DictionaryInfo]:
        wl_root = self._root / "whitelist"
        if not wl_root.is_dir():
            return []
        out: list[DictionaryInfo] = []
        for label_dir in sorted(wl_root.iterdir()):
            if not label_dir.is_dir():
                continue
            label = label_dir.name.upper()
            if label_filter and label != label_filter.upper():
                continue
            for path in sorted(label_dir.iterdir()):
                if path.is_file() and path.suffix in (".txt", ".csv", ".json"):
                    terms = self._load_terms(path)
                    out.append(DictionaryInfo(
                        kind="whitelist",
                        label=label,
                        name=path.stem,
                        filename=path.name,
                        term_count=len(terms),
                    ))
        return out

    def _list_blacklist(self) -> list[DictionaryInfo]:
        bl_root = self._blacklist_dir()
        if not bl_root.is_dir():
            return []
        out: list[DictionaryInfo] = []
        for path in sorted(bl_root.iterdir()):
            if path.is_file() and path.suffix in (".txt", ".csv", ".json"):
                terms = self._load_terms(path)
                out.append(DictionaryInfo(
                    kind="blacklist",
                    label=None,
                    name=path.stem,
                    filename=path.name,
                    term_count=len(terms),
                ))
        return out

    # -- get terms -----------------------------------------------------------

    def get_terms(self, kind: DictKind, name: str, label: str | None = None) -> list[str]:
        """Load and return parsed terms from a dictionary by name.

        Raises ``FileNotFoundError`` if the dictionary does not exist.
        """
        path = self._resolve_path(kind, name, label)
        if path is None:
            loc = f"{kind}/{label}/{name}" if label else f"{kind}/{name}"
            raise FileNotFoundError(f"dictionary not found: {loc}")
        return self._load_terms(path)

    # -- save ----------------------------------------------------------------

    def save(
        self,
        kind: DictKind,
        name: str,
        content: str,
        label: str | None = None,
        extension: str = ".txt",
    ) -> DictionaryInfo:
        """Write a dictionary file. Overwrites if it already exists."""
        if kind == "whitelist":
            if label is None:
                raise ValueError("whitelist dictionaries require a label")
            parent = self._whitelist_dir(label)
        else:
            parent = self._blacklist_dir()
        parent.mkdir(parents=True, exist_ok=True)

        # Remove any existing file with the same stem but different extension
        for existing in parent.iterdir():
            if existing.is_file() and existing.stem == name:
                existing.unlink()

        ext = extension if extension.startswith(".") else f".{extension}"
        path = parent / f"{name}{ext}"
        path.write_text(content, encoding="utf-8")

        terms = self._load_terms(path)
        return DictionaryInfo(
            kind=kind,
            label=label.upper() if label else None,
            name=name,
            filename=path.name,
            term_count=len(terms),
        )

    # -- delete --------------------------------------------------------------

    def delete(self, kind: DictKind, name: str, label: str | None = None) -> None:
        """Remove a dictionary file. Raises ``FileNotFoundError`` if missing."""
        path = self._resolve_path(kind, name, label)
        if path is None:
            loc = f"{kind}/{label}/{name}" if label else f"{kind}/{name}"
            raise FileNotFoundError(f"dictionary not found: {loc}")
        path.unlink()

    # -- helpers -------------------------------------------------------------

    @staticmethod
    def _load_terms(path: Path) -> list[str]:
        text = path.read_text(encoding="utf-8")
        return parse_list_file(text, filename=path.name)

    # -- preview / paginated browse ------------------------------------------

    def get_preview(
        self,
        kind: DictKind,
        name: str,
        label: str | None = None,
        sample_size: int = 20,
    ) -> dict:
        """Return metadata and a sample of terms for a dictionary.

        Returns dict with keys: kind, label, name, term_count, sample_terms, file_size_bytes.
        Raises ``FileNotFoundError`` if the dictionary does not exist.
        """
        path = self._resolve_path(kind, name, label)
        if path is None:
            loc = f"{kind}/{label}/{name}" if label else f"{kind}/{name}"
            raise FileNotFoundError(f"dictionary not found: {loc}")
        terms = self._load_terms(path)
        return {
            "kind": kind,
            "label": label.upper() if label else None,
            "name": name,
            "term_count": len(terms),
            "sample_terms": terms[:sample_size],
            "file_size_bytes": path.stat().st_size,
        }

    def get_terms_paginated(
        self,
        kind: DictKind,
        name: str,
        label: str | None = None,
        offset: int = 0,
        limit: int = 50,
        search: str | None = None,
    ) -> dict:
        """Return a page of terms with optional text filter.

        Returns dict with keys: terms, total, offset, limit, search.
        Raises ``FileNotFoundError`` if the dictionary does not exist.
        """
        path = self._resolve_path(kind, name, label)
        if path is None:
            loc = f"{kind}/{label}/{name}" if label else f"{kind}/{name}"
            raise FileNotFoundError(f"dictionary not found: {loc}")
        terms = self._load_terms(path)
        if search:
            needle = search.casefold()
            terms = [t for t in terms if needle in t.casefold()]
        total = len(terms)
        page = terms[offset : offset + limit]
        return {
            "terms": page,
            "total": total,
            "offset": offset,
            "limit": limit,
            "search": search,
        }

    # -- bulk load for pipes -------------------------------------------------

    def load_whitelist_terms(self, names: list[str], label: str) -> list[str]:
        """Load and merge terms from multiple whitelist dictionaries for a label."""
        all_terms: list[str] = []
        for name in names:
            all_terms.extend(self.get_terms("whitelist", name, label=label))
        return all_terms

    def load_blacklist_terms(self, names: list[str]) -> list[str]:
        """Load and merge terms from multiple blacklist dictionaries."""
        all_terms: list[str] = []
        for name in names:
            all_terms.extend(self.get_terms("blacklist", name))
        return all_terms
