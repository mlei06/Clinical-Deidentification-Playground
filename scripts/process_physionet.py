#!/usr/bin/env python3
"""
Convert PhysioNet-style id.text + ann.csv to BRAT, split train/valid/test.
Labels stay as in the CSV unless you pass ``--label-map`` (JSON of source→target types).
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import shutil
from pathlib import Path
from typing import Any


def split_records(input_file: str) -> list[tuple[str, str]]:
    """Split id.text by END_OF_RECORD markers; return list of (record_id, text)."""
    with open(input_file, encoding="utf-8") as f:
        content = f.read()

    chunks = re.split(r"\|+END_OF_RECORD\s*", content)
    result: list[tuple[str, str]] = []

    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
        lines = chunk.split("\n", 1)
        first = lines[0].strip()
        if not first.startswith("START_OF_RECORD="):
            continue
        record_id = first.removeprefix("START_OF_RECORD=").strip()
        text = lines[1] if len(lines) > 1 else ""
        text = text.strip().replace("\n", " ")
        result.append((record_id, text))

    return result


def convert_to_brat(text_path: str, annotation_csv: str, output_dir: str) -> None:
    """Convert raw text and CSV annotations to BRAT format (flat directory)."""
    import pandas as pd

    print(f"Reading text: {text_path}")
    records = split_records(text_path)
    print(f"Found {len(records)} records")

    df = pd.read_csv(annotation_csv, dtype={"record_id": str})
    df["record_id"] = df["record_id"].astype(str).str.strip()

    os.makedirs(output_dir, exist_ok=True)

    for i, (record_id, text) in enumerate(records):
        entities: list[tuple[str, int, int, str]] = []
        matched_rows = df[df["record_id"] == record_id]

        for _, row in matched_rows.iterrows():
            start = int(row["begin"])
            length = int(row["length"])
            end = start + length
            entity = str(row["type"]).strip()

            if end > len(text) or start < 0:
                continue

            span_text = text[start:end]
            entities.append((entity, start, end, span_text))

        txt_path = os.path.join(output_dir, f"note_{i + 1}.txt")
        ann_path = os.path.join(output_dir, f"note_{i + 1}.ann")

        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(text)

        with open(ann_path, "w", encoding="utf-8") as f:
            for j, (label, start, end, span_text) in enumerate(entities):
                f.write(f"T{j + 1}\t{label} {start} {end}\t{span_text}\n")


def modify_labels(input_dir: str, output_dir: str, label_mappings: dict[str, str]) -> None:
    """Rewrite BRAT ``.ann`` entity types using ``label_mappings`` (only keys present are changed)."""
    for split in ("train", "valid", "test"):
        os.makedirs(os.path.join(output_dir, split), exist_ok=True)

    for split in ("train", "valid", "test"):
        input_split_dir = os.path.join(input_dir, split)
        output_split_dir = os.path.join(output_dir, split)
        print(f"Label mapping: {split} ...")

        record_ids = {
            os.path.splitext(f)[0] for f in os.listdir(input_split_dir) if f.endswith(".ann")
        }

        for record_id in record_ids:
            txt_src = os.path.join(input_split_dir, f"{record_id}.txt")
            txt_dst = os.path.join(output_split_dir, f"{record_id}.txt")
            shutil.copy2(txt_src, txt_dst)

            ann_src = os.path.join(input_split_dir, f"{record_id}.ann")
            ann_dst = os.path.join(output_split_dir, f"{record_id}.ann")

            with open(ann_src, encoding="utf-8") as src, open(ann_dst, "w", encoding="utf-8") as dst:
                for line in src:
                    if line.startswith("T"):
                        parts = line.strip().split("\t")
                        if len(parts) >= 2:
                            ann_details = parts[1].split()
                            if len(ann_details) >= 3:
                                entity_type = ann_details[0]
                                if entity_type in label_mappings:
                                    ann_details[0] = label_mappings[entity_type]
                                    parts[1] = " ".join(ann_details)
                                    line = "\t".join(parts) + "\n"
                    dst.write(line)


def split_dataset(input_dir: str, output_dir: str, train_ratio: float = 0.7, val_ratio: float = 0.15) -> None:
    """Split flat BRAT dir into train/valid/test."""
    os.makedirs(output_dir, exist_ok=True)
    random.seed(42)

    train_dir = os.path.join(output_dir, "train")
    val_dir = os.path.join(output_dir, "valid")
    test_dir = os.path.join(output_dir, "test")
    for d in (train_dir, val_dir, test_dir):
        os.makedirs(d, exist_ok=True)

    ann_files = [f for f in os.listdir(input_dir) if f.endswith(".ann")]
    random.shuffle(ann_files)

    total_files = len(ann_files)
    train_cutoff = int(total_files * train_ratio)
    val_cutoff = train_cutoff + int(total_files * val_ratio)

    train_files = ann_files[:train_cutoff]
    val_files = ann_files[train_cutoff:val_cutoff]
    test_files = ann_files[val_cutoff:]

    print(f"Split — train: {len(train_files)} | valid: {len(val_files)} | test: {len(test_files)}")

    for files, dst_dir in ((train_files, train_dir), (val_files, val_dir), (test_files, test_dir)):
        for ann_file in files:
            txt_file = ann_file.replace(".ann", ".txt")
            src_ann = os.path.join(input_dir, ann_file)
            src_txt = os.path.join(input_dir, txt_file)
            if os.path.isfile(src_txt):
                shutil.copy2(src_ann, os.path.join(dst_dir, ann_file))
                shutil.copy2(src_txt, os.path.join(dst_dir, txt_file))


def process_physionet(
    text_path: str,
    annotation_csv: str,
    output_dir: str,
    label_map: dict[str, str] | None = None,
    temp_dir: str | None = None,
) -> None:
    """Convert to BRAT, split, optionally map labels from ``label_map``, write to output_dir."""
    if temp_dir is None:
        temp_dir = os.path.join(os.path.dirname(output_dir), ".tmp_brat_work")
    split_temp = os.path.join(temp_dir, "split")
    modified_dir = os.path.join(temp_dir, "modified")

    try:
        convert_to_brat(text_path, annotation_csv, temp_dir)

        split_dataset(temp_dir, split_temp)

        if label_map:
            shutil.rmtree(modified_dir, ignore_errors=True)
            modify_labels(split_temp, modified_dir, label_map)
            final_src = modified_dir
        else:
            final_src = split_temp

        os.makedirs(os.path.dirname(os.path.abspath(output_dir)) or ".", exist_ok=True)
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir)
        shutil.copytree(final_src, output_dir)
        print(f"Done. Output: {output_dir}")

    finally:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)


def _load_label_map(path: Path) -> dict[str, str]:
    raw: Any = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("label map JSON must be an object")
    out: dict[str, str] = {}
    for k, v in raw.items():
        if not isinstance(k, str) or not isinstance(v, str):
            raise ValueError("label map must be string → string")
        out[k] = v
    return out


def main() -> None:
    parser = argparse.ArgumentParser(
        description="PhysioNet id.text + ann.csv → BRAT train/valid/test; optional --label-map JSON"
    )
    parser.add_argument("--text", required=True, help="Path to id.text")
    parser.add_argument("--annotations", required=True, help="Path to ann.csv")
    parser.add_argument("--output", required=True, help="Output directory (created/replaced)")
    parser.add_argument(
        "--label-map",
        type=Path,
        default=None,
        help="JSON file: {\"SOURCE_TYPE\": \"TARGET_TYPE\", ...}; omit to keep CSV/BRAT labels as-is",
    )
    parser.add_argument(
        "--temp-dir",
        default=None,
        help="Working directory for intermediate BRAT (default: sibling .tmp_brat_work next to --output)",
    )
    args = parser.parse_args()
    label_map = _load_label_map(args.label_map) if args.label_map else None
    process_physionet(
        args.text,
        args.annotations,
        args.output,
        label_map=label_map,
        temp_dir=args.temp_dir,
    )


if __name__ == "__main__":
    main()
