"""NOTEEVENTS CSV → synthetic BRAT corpus (placeholder fill, merge, optional split)."""

from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path

from clinical_deid.ingest.mimic.brat_merge import BratT, merge_brat_directory_flat
from clinical_deid.ingest.mimic.faker_providers import getrandformat
from clinical_deid.ingest.mimic.placeholders import extract_placeholders
from clinical_deid.ingest.mimic.replacement import get_placeholder_entity, get_replaced_text
from clinical_deid.ingest.mimic.split import split_brat_directory_to_corpus

logger = logging.getLogger(__name__)


def process_note_text(note_text: str, *, note_id: str | None = None) -> tuple[str, list[BratT]]:
    """
    Replace ``[**...**]`` placeholders with synthetic spans; return deidentified text and BRAT tuples.

    ``note_id`` is only used for logging hooks / future use.
    """
    del note_id
    placeholders = extract_placeholders(note_text)
    placeholders.sort(key=lambda x: x["start"])

    replacements: list[BratT] = []
    processed_text = note_text
    offset = 0
    randformat_dict = getrandformat()

    for p in placeholders:
        entity_type = get_placeholder_entity(p["content"])
        if (
            not entity_type
            or entity_type.strip() == ""
            or entity_type.lower() == "blank"
        ):
            continue

        output = get_replaced_text(entity_type, randformat_dict)
        if not output:
            continue

        replacement, brat_entity_type = output
        orig_start = p["start"]
        orig_end = p["end"]
        orig_length = orig_end - orig_start
        repl_length = len(replacement)

        adj_start = orig_start + offset
        adj_end = orig_end + offset

        processed_text = processed_text[:adj_start] + replacement + processed_text[adj_end:]

        new_start = adj_start
        new_end = adj_start + repl_length
        replacements.append((new_start, new_end, brat_entity_type, replacement))

        offset += repl_length - orig_length

    # Replace newlines with spaces, then adjust replacement offsets to match
    final_text = processed_text.replace("\n", " ")
    return final_text, replacements


def write_brat_note(output_dir: Path, note_id: str, text: str, spans: list[BratT]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    txt_path = output_dir / f"{note_id}.txt"
    ann_path = output_dir / f"{note_id}.ann"
    txt_path.write_text(text, encoding="utf-8")
    lines = [
        f"T{i}\t{entity_type} {start} {end}\t{surface}\n"
        for i, (start, end, entity_type, surface) in enumerate(spans, 1)
    ]
    ann_path.write_text("".join(lines), encoding="utf-8")


def process_noteevents_to_brat_flat(
    csv_path: Path,
    output_dir: Path,
    *,
    chunksize: int = 1000,
    max_notes: int | None = None,
    text_column: str = "TEXT",
    id_formatter: Callable[[int, object], str] | None = None,
    progress_every: int = 1000,
) -> int:
    """
    Stream ``csv_path`` and write paired BRAT files into flat ``output_dir``.

    Returns number of notes written.
    """
    try:
        import pandas as pd
    except ImportError as e:
        raise ImportError(
            "processing MIMIC NOTEEVENTS requires pandas; "
            "install with: pip install clinical-deid-playground[scripts]"
        ) from e

    output_dir.mkdir(parents=True, exist_ok=True)
    notes_written = 0

    def default_id(chunk_num: int, row_index: object) -> str:
        return f"note_{chunk_num}_{row_index}"

    fmt = id_formatter or default_id

    for chunk_num, chunk in enumerate(
        pd.read_csv(csv_path, chunksize=chunksize, low_memory=False)
    ):
        for idx, row in chunk.iterrows():
            raw = row.get(text_column)
            if pd.isna(raw):
                continue
            note_text = str(raw)
            note_id = fmt(chunk_num, idx)
            processed_text, replacements = process_note_text(note_text, note_id=note_id)
            write_brat_note(output_dir, note_id, processed_text, replacements)
            notes_written += 1
            if progress_every and notes_written % progress_every == 0:
                logger.info("Processed %s notes", notes_written)
            if max_notes is not None and notes_written >= max_notes:
                logger.info("Stopped after %s notes (max_notes)", max_notes)
                return notes_written

    return notes_written


def run_noteevents_pipeline(
    csv_path: Path,
    output_root: Path,
    *,
    chunksize: int = 1000,
    max_notes: int | None = None,
    merge_adjacent_patient: bool = True,
    split_into_subdirs: bool = True,
    train_ratio: float = 0.75,
    valid_ratio: float = 0.05,
    test_ratio: float = 0.20,
    split_seed: int = 42,
) -> None:
    """
    End-to-end: flat BRAT under ``output_root`` → optional in-place PATIENT merge →
    optional move into ``train``/``valid``/``test`` (same root), matching the Neuroner script.
    """
    output_root.mkdir(parents=True, exist_ok=True)
    process_noteevents_to_brat_flat(
        csv_path,
        output_root,
        chunksize=chunksize,
        max_notes=max_notes,
    )
    if merge_adjacent_patient:
        merge_brat_directory_flat(output_root, output_root)
    if split_into_subdirs:
        split_brat_directory_to_corpus(
            output_root,
            output_root,
            train_ratio=train_ratio,
            valid_ratio=valid_ratio,
            test_ratio=test_ratio,
            seed=split_seed,
        )
