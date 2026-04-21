#!/usr/bin/env python3
"""Export the best NeuroNER checkpoint to models/neuroner/<name>/.

Reads the training output directory produced by neuroner, finds the best epoch
from results.json, copies and renames the checkpoint files, and generates a
model_manifest.json for pipeline integration.

Run with the **NeuroNER venv** (``neuroner-cspmc/venv/bin/python``): ``dataset.pickle`` must unpickle
NeuroNER classes, which are not importable from the main app Python.

Usage:
    neuroner-cspmc/venv/bin/python scripts/neuroner_export.py \
        --training-output output/neuroner/<run_dir> \
        --model-name my_model \
        --models-dir models/neuroner

    # Or to export a specific epoch:
    neuroner-cspmc/venv/bin/python scripts/neuroner_export.py \
        --training-output output/neuroner/<run_dir> \
        --model-name my_model \
        --models-dir models/neuroner \
        --epoch 42
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import pickle
import shutil
import sys


def find_best_epoch(results_path: str) -> int:
    """Find the epoch with the best validation F1 score."""
    with open(results_path) as f:
        results = json.load(f)

    best_epoch = 0
    best_f1 = -1.0

    for epoch_str, epoch_data in results.get("epoch", {}).items():
        epoch_num = int(epoch_str)
        # epoch_data is a list of result dicts
        for result in epoch_data:
            valid = result.get("valid", {})
            f1 = valid.get("f1_score", {}).get("micro", -1.0)
            if f1 > best_f1:
                best_f1 = f1
                best_epoch = epoch_num

    return best_epoch


def extract_labels(dataset_pickle_path: str) -> list[str]:
    """Extract entity label names from dataset.pickle (BIOES prefixes stripped)."""
    with open(dataset_pickle_path, "rb") as f:
        ds = pickle.load(f)

    labels = set()
    for label in ds.unique_labels:
        if label == "O":
            continue
        if label[:2] in ("B-", "I-", "E-", "S-"):
            labels.add(label[2:])
        else:
            labels.add(label)

    return sorted(labels)


def read_parameters_ini(params_path: str) -> dict[str, str]:
    """Read key training parameters from parameters.ini."""
    import configparser

    cfg = configparser.ConfigParser()
    cfg.read(params_path, encoding="UTF-8")
    flat = {}
    for section in cfg.sections():
        flat.update(dict(cfg[section]))
    return flat


def main():
    parser = argparse.ArgumentParser(description="Export a NeuroNER training run to models/neuroner/")
    parser.add_argument("--training-output", required=True, help="Path to the training output directory (contains model/, results.json)")
    parser.add_argument("--model-name", required=True, help="Name for the exported model")
    parser.add_argument("--models-dir", default="models/neuroner", help="Parent directory for model output")
    parser.add_argument("--epoch", type=int, default=None, help="Specific epoch to export (default: best validation F1)")
    parser.add_argument("--description", default="", help="Description for model manifest")
    parser.add_argument("--base-model", default="", help="Name of the pretrained model used for fine-tuning")
    args = parser.parse_args()

    training_output = args.training_output.rstrip("/")
    model_dir = os.path.join(training_output, "model")
    results_path = os.path.join(training_output, "results.json")
    dataset_pickle = os.path.join(model_dir, "dataset.pickle")
    params_ini = os.path.join(model_dir, "parameters.ini")

    # Validate inputs
    if not os.path.isdir(model_dir):
        print(f"ERROR: model/ directory not found in {training_output}", file=sys.stderr)
        sys.exit(1)
    if not os.path.isfile(dataset_pickle):
        print(f"ERROR: dataset.pickle not found in {model_dir}", file=sys.stderr)
        sys.exit(1)

    # Determine best epoch
    if args.epoch is not None:
        epoch = args.epoch
        print(f"Using specified epoch: {epoch}")
    elif os.path.isfile(results_path):
        epoch = find_best_epoch(results_path)
        print(f"Best validation epoch: {epoch}")
    else:
        # Fall back to latest checkpoint
        ckpts = glob.glob(os.path.join(model_dir, "model_*.ckpt.index"))
        if not ckpts:
            print("ERROR: No checkpoints found and no results.json to pick best epoch", file=sys.stderr)
            sys.exit(1)
        epoch = max(int(os.path.basename(c).split("_")[1].split(".")[0]) for c in ckpts)
        print(f"No results.json found, using latest epoch: {epoch}")

    # Verify checkpoint files exist
    epoch_str = f"{epoch:05d}"
    ckpt_prefix = os.path.join(model_dir, f"model_{epoch_str}.ckpt")
    ckpt_files = glob.glob(f"{ckpt_prefix}*")
    if not ckpt_files:
        print(f"ERROR: No checkpoint files found for epoch {epoch}: {ckpt_prefix}*", file=sys.stderr)
        sys.exit(1)

    # Create output directory
    out_dir = os.path.join(args.models_dir, args.model_name)
    if os.path.exists(out_dir):
        print(f"ERROR: Output directory already exists: {out_dir}", file=sys.stderr)
        sys.exit(1)
    os.makedirs(out_dir)

    # Copy and rename checkpoint files: model_00042.ckpt.* → model.ckpt.*
    for src in ckpt_files:
        suffix = os.path.basename(src).replace(f"model_{epoch_str}.ckpt", "model.ckpt")
        dst = os.path.join(out_dir, suffix)
        shutil.copy2(src, dst)
        print(f"  {os.path.basename(src)} -> {suffix}")

    # Write checkpoint pointer file
    with open(os.path.join(out_dir, "checkpoint"), "w") as f:
        f.write('model_checkpoint_path: "model.ckpt"\n')
        f.write('all_model_checkpoint_paths: "model.ckpt"\n')

    # Copy dataset.pickle and parameters.ini
    shutil.copy2(dataset_pickle, out_dir)
    print(f"  dataset.pickle")
    if os.path.isfile(params_ini):
        shutil.copy2(params_ini, out_dir)
        print(f"  parameters.ini")

    # Extract labels and training info
    labels = extract_labels(dataset_pickle)
    params = read_parameters_ini(params_ini) if os.path.isfile(params_ini) else {}
    tokenizer = params.get("tokenizer", "spacy")
    tagging_format = params.get("tagging_format", "bioes")

    # Build description
    description = args.description
    if not description:
        parts = [f"NeuroNER LSTM-CRF"]
        if args.base_model:
            parts.append(f"fine-tuned from {args.base_model}")
        parts.append(f"({tokenizer} tokenizer, {tagging_format})")
        description = " ".join(parts)

    # Read results for metadata
    best_f1 = None
    if os.path.isfile(results_path):
        with open(results_path) as f:
            results = json.load(f)
        epoch_data = results.get("epoch", {}).get(str(epoch), [{}])
        if epoch_data:
            best_f1 = epoch_data[0].get("valid", {}).get("f1_score", {}).get("micro")

    # Generate model_manifest.json
    manifest = {
        "name": args.model_name,
        "framework": "neuroner",
        "labels": labels,
        "description": description,
        "base_model": args.base_model or "GloVe 6B 100d",
        "device": "cpu",
        "epoch": epoch,
    }
    if best_f1 is not None:
        manifest["valid_f1_micro"] = round(best_f1, 4)

    manifest_path = os.path.join(out_dir, "model_manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    print(f"  model_manifest.json")

    print(f"\nExported {args.model_name} (epoch {epoch}) to {out_dir}")
    print(f"Labels: {', '.join(labels)}")
    if best_f1 is not None:
        print(f"Validation F1 (micro): {best_f1:.2f}")


if __name__ == "__main__":
    main()
