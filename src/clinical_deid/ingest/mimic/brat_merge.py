"""Merge adjacent PATIENT spans separated by a single space (post-processing step)."""

from __future__ import annotations

from pathlib import Path
from typing import NamedTuple

BratT = tuple[int, int, str, str]


class BratAnnotation(NamedTuple):
    start: int
    end: int
    entity_type: str
    text: str


def read_brat_ann(ann_path: Path) -> list[BratT]:
    annotations: list[BratT] = []
    for line in ann_path.read_text(encoding="utf-8").splitlines():
        if not line.startswith("T"):
            continue
        parts = line.strip().split("\t")
        if len(parts) < 2:
            continue
        type_pos = parts[1].split()
        if len(type_pos) < 3:
            continue
        entity_type = type_pos[0]
        start = int(type_pos[1])
        end = int(type_pos[2])
        surface = parts[2] if len(parts) > 2 else ""
        annotations.append((start, end, entity_type, surface))
    return annotations


def merge_adjacent_names(annotations: list[BratT], text_content: str) -> list[BratT]:
    if not annotations:
        return annotations
    sorted_anns = sorted(annotations, key=lambda x: x[0])
    merged: list[BratT] = []
    cur = list(sorted_anns[0])

    for next_ann in sorted_anns[1:]:
        if cur[2] == "NAME" and next_ann[2] == "NAME":
            between_text = text_content[cur[1] : next_ann[0]]
            if between_text == " ":
                cur[1] = next_ann[1]
                cur[3] = cur[3] + " " + next_ann[3]
            else:
                merged.append(tuple(cur))  # type: ignore[arg-type]
                cur = list(next_ann)
        else:
            merged.append(tuple(cur))  # type: ignore[arg-type]
            cur = list(next_ann)

    merged.append(tuple(cur))  # type: ignore[arg-type]
    return merged


def write_brat_ann(path: Path, annotations: list[BratT]) -> None:
    lines = [
        f"T{i}\t{entity_type} {start} {end}\t{surface}\n"
        for i, (start, end, entity_type, surface) in enumerate(annotations, 1)
    ]
    path.write_text("".join(lines), encoding="utf-8")


def merge_brat_directory_flat(input_dir: Path, output_dir: Path) -> None:
    """Read paired ``.txt`` / ``.ann`` from ``input_dir``; write merged annotations to ``output_dir``."""
    output_dir.mkdir(parents=True, exist_ok=True)
    for txt_path in sorted(input_dir.glob("*.txt")):
        ann_path = txt_path.with_suffix(".ann")
        if not ann_path.is_file():
            continue
        text_content = txt_path.read_text(encoding="utf-8")
        anns = merge_adjacent_names(read_brat_ann(ann_path), text_content)
        out_txt = output_dir / txt_path.name
        out_ann = output_dir / ann_path.name
        out_txt.write_text(text_content, encoding="utf-8")
        write_brat_ann(out_ann, anns)
