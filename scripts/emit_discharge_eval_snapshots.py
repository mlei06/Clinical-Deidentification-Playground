"""Emit JSON eval snapshots for shipped discharge_summaries + data/pipelines/*.

Run from repo root with dev install::

    python scripts/emit_discharge_eval_snapshots.py

Writes ``data/evaluations/discharge-summaries__<pipeline>.json`` (stable names for docs/git).
Skips a pipeline if its graph fails to load (e.g. missing optional deps).
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from clinical_deid.config import get_settings
from clinical_deid.eval.runner import evaluate_pipeline
from clinical_deid.ingest.sources import load_annotated_corpus
from clinical_deid.pipeline_store import load_pipeline_config
from clinical_deid.pipes.registry import load_pipeline
from clinical_deid.risk import default_risk_profile

# Reuse API serialization
from clinical_deid.api.routers.evaluation import (  # noqa: E402
    _eval_metrics_to_dict,
    _match_result_to_dict,
    _redaction_metrics_to_dict,
)

PIPELINES = [
    "clinical-fast",
    "presidio",
    "clinical-transformer",
    "clinical-transformer-presidio",
]
CORPUS = "discharge_summaries"
DATASET_SOURCE = f"dataset:{CORPUS}"


def _metrics_dict(result) -> dict:
    eval_risk_profile = default_risk_profile()
    per_label_dict = {}
    for label, lm in result.per_label.items():
        per_label_dict[label] = {
            "strict": _match_result_to_dict(lm.strict),
            "partial_overlap": _match_result_to_dict(lm.partial_overlap),
            "token_level": _match_result_to_dict(lm.token_level),
            "support": lm.support,
        }
    out: dict = {
        "overall": _eval_metrics_to_dict(result.overall),
        "per_label": per_label_dict,
        "risk_weighted_recall": result.risk_weighted_recall,
        "label_confusion": result.label_confusion,
        "has_redaction": result.has_redaction,
        "risk_profile_name": eval_risk_profile.name,
    }
    if result.redaction is not None:
        out["redaction"] = _redaction_metrics_to_dict(result.redaction)
    return out


def main() -> None:
    settings = get_settings()
    home = settings.corpora_dir / CORPUS
    jsonl = home / "corpus.jsonl"
    if not jsonl.is_file():
        print(f"Missing {jsonl}", file=sys.stderr)
        raise SystemExit(1)

    golds = load_annotated_corpus(jsonl=jsonl)
    out_dir = settings.evaluations_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    for name in PIPELINES:
        try:
            config = load_pipeline_config(settings.pipelines_dir, name)
        except FileNotFoundError:
            print(f"skip (no file): {name}", file=sys.stderr)
            continue
        try:
            pl = load_pipeline(config)
        except Exception as exc:
            print(f"skip (load {name}): {exc}", file=sys.stderr)
            continue
        result = evaluate_pipeline(pl, golds, risk_profile=default_risk_profile())
        payload = {
            "id": f"discharge-summaries__{name}",
            "pipeline_name": name,
            "dataset_source": DATASET_SOURCE,
            "document_count": result.document_count,
            "metrics": _metrics_dict(result),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        path = out_dir / f"discharge-summaries__{name}.json"
        path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        o = result.overall.strict
        print(f"wrote {path} strict_f1={o.f1:.4f} rwr={result.risk_weighted_recall:.4f}")


if __name__ == "__main__":
    main()
