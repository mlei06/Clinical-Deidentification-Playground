"""NeuroNER inference sidecar — FastAPI + uvicorn (Python 3.7 + TensorFlow 1.x).

Loads NeuroNER in a background task so ``GET /health`` can poll until ready.

Each request can identify the checkpoint by:

* ``model`` — directory name under ``NEURONER_MODELS_ROOT`` (default for the main app pipe).
* ``model_folder`` — absolute path inside the container to the pretrained model directory
  (must resolve under ``NEURONER_MODELS_ROOT``).

Environment — see ``docker/neuroner/README.md``.
"""
from __future__ import annotations

import os
import re
import sys
import threading
import traceback
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

_predict_lock = threading.Lock()
_load_lock = threading.Lock()
_nn = None
_entity_labels: List[str] = []
_load_error = None
_loading_done = threading.Event()
_current_loaded_folder: Optional[str] = None
_current_display_name: Optional[str] = None

if os.environ.get("NEURONER_MODELS_ROOT"):
    _MODELS_ROOT = os.path.abspath(
        os.environ["NEURONER_MODELS_ROOT"].rstrip("/")
    )
    _DEFAULT_MODEL = os.environ.get(
        "NEURONER_DEFAULT_MODEL", "i2b2_2014_glove_spacy_bioes"
    )
else:
    _legacy = os.environ.get(
        "NEURONER_MODEL_FOLDER",
        "/models/neuroner/i2b2_2014_glove_spacy_bioes",
    )
    _legacy = os.path.abspath(_legacy)
    _MODELS_ROOT = os.path.dirname(_legacy)
    _DEFAULT_MODEL = os.path.basename(_legacy)


def _extract_entity_labels(modeldata):
    raw = set()
    for label in modeldata.unique_labels:
        if len(label) >= 2 and label[:2] in ("B-", "I-", "E-", "S-"):
            raw.add(label[2:])
    return sorted(raw)


def _safe_pretrained_folder(models_root: str, model_name: str) -> str:
    if not model_name or not re.match(r"^[A-Za-z0-9._-]+$", model_name):
        raise ValueError("invalid model name")
    candidate = os.path.join(models_root, model_name)
    root_r = os.path.realpath(models_root)
    cand_r = os.path.realpath(candidate)
    sep = os.sep
    if not (cand_r == root_r or cand_r.startswith(root_r + sep)):
        raise ValueError("invalid model path")
    if not os.path.isdir(cand_r):
        raise ValueError("model directory not found: %s" % model_name)
    return cand_r


def _validate_model_folder(path: str) -> str:
    """Absolute pretrained folder; must lie under NEURONER_MODELS_ROOT."""
    abs_path = os.path.realpath(os.path.abspath(path))
    root_r = os.path.realpath(_MODELS_ROOT)
    sep = os.sep
    if not (abs_path == root_r or abs_path.startswith(root_r + sep)):
        raise ValueError(
            "model_folder must resolve under NEURONER_MODELS_ROOT (%s)" % root_r
        )
    if not os.path.isdir(abs_path):
        raise ValueError("model_folder is not a directory: %s" % path)
    return abs_path


def resolve_pretrained_folder(
    model: Optional[str],
    model_folder: Optional[str],
) -> str:
    """Return realpath to the checkpoint directory."""
    if model_folder:
        if model:
            raise ValueError("pass only one of model or model_folder")
        return _validate_model_folder(model_folder)
    name = model or _DEFAULT_MODEL
    return _safe_pretrained_folder(_MODELS_ROOT, name)


def _load_neuro_session(pretrained_folder: str):
    root = os.environ["NEURONER_ROOT"]
    os.chdir(root)
    if root not in sys.path:
        sys.path.insert(0, root)
    from neuroner.neuromodel import NeuroNER

    nn = NeuroNER(
        train_model=False,
        use_pretrained_model=True,
        pretrained_model_folder=pretrained_folder,
        dataset_text_folder=os.environ["NEURONER_DATASET_TEXT_FOLDER"],
        token_pretrained_embedding_filepath=os.environ["NEURONER_TOKEN_EMBEDDING"],
        output_folder=os.environ.get("NEURONER_OUTPUT_FOLDER", "/tmp/neuroner_out"),
    )
    nn.fit()
    return nn, _extract_entity_labels(nn.modeldata)


def _switch_to_folder(pretrained_folder: str) -> bool:
    """Load checkpoint at ``pretrained_folder`` (realpath). Keeps prior model on failure."""
    global _nn, _entity_labels, _load_error, _current_loaded_folder, _current_display_name
    pretrained_folder = os.path.realpath(pretrained_folder)
    with _load_lock:
        if _current_loaded_folder == pretrained_folder and _nn is not None:
            _load_error = None
            return True
        try:
            nn, labels = _load_neuro_session(pretrained_folder)
            _nn = nn
            _entity_labels = labels
            _current_loaded_folder = pretrained_folder
            _current_display_name = os.path.basename(
                pretrained_folder.rstrip(os.sep)
            )
            _load_error = None
            sys.stderr.write("NeuroNER loaded %s\n" % pretrained_folder)
            sys.stderr.flush()
            return True
        except Exception as exc:
            _load_error = exc
            sys.stderr.write("NeuroNER load failed: %s\n" % exc)
            traceback.print_exc()
            return False


def _switch_model(model_name: str) -> bool:
    global _load_error
    try:
        folder = _safe_pretrained_folder(_MODELS_ROOT, model_name)
    except Exception as exc:
        _load_error = exc
        sys.stderr.write("NeuroNER model resolve failed: %s\n" % exc)
        return False
    return _switch_to_folder(folder)


def _initial_load():
    try:
        _switch_model(_DEFAULT_MODEL)
    finally:
        _loading_done.set()


threading.Thread(target=_initial_load, name="neuroner-load", daemon=True).start()

app = FastAPI(
    title="NeuroNER inference",
    version="1.0",
    description="TensorFlow 1.x NeuroNER HTTP sidecar",
)


class PredictBody(BaseModel):
    text: str = ""
    model: Optional[str] = Field(
        None,
        description="Subdirectory name under NEURONER_MODELS_ROOT",
    )
    model_folder: Optional[str] = Field(
        None,
        description="Absolute path to pretrained model dir (must be under NEURONER_MODELS_ROOT)",
    )


@app.get("/health")
@app.get("/")
def health():
    if not _loading_done.is_set():
        return JSONResponse(
            status_code=503,
            content={"status": "loading"},
        )
    if _nn is None:
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "detail": str(_load_error) if _load_error else "no model loaded",
            },
        )
    return {
        "status": "ok",
        "model": _current_display_name,
        "model_folder": _current_loaded_folder,
        "models_root": _MODELS_ROOT,
    }


@app.get("/v1/labels")
def labels(
    model: Optional[str] = Query(
        None,
        description="Model name under models root (omit to use default or current)",
    ),
    model_folder: Optional[str] = Query(
        None,
        description="Absolute pretrained folder inside the container",
    ),
):
    if not _loading_done.is_set():
        raise HTTPException(status_code=503, detail={"status": "loading"})
    try:
        folder = resolve_pretrained_folder(model, model_folder)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    with _predict_lock:
        if not _switch_to_folder(folder):
            raise HTTPException(
                status_code=503,
                detail={"error": "load_failed", "detail": str(_load_error)},
            )
        labels_out = list(_entity_labels)
    return {
        "labels": labels_out,
        "model": _current_display_name,
        "model_folder": _current_loaded_folder,
    }


@app.post("/v1/predict")
def predict(body: PredictBody):
    if not _loading_done.is_set():
        raise HTTPException(status_code=503, detail={"status": "loading"})
    try:
        folder = resolve_pretrained_folder(body.model, body.model_folder)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    try:
        with _predict_lock:
            if not _switch_to_folder(folder):
                raise HTTPException(
                    status_code=503,
                    detail={"error": "load_failed", "detail": str(_load_error)},
                )
            if not (body.text or "").strip():
                return {
                    "entities": [],
                    "model": _current_display_name,
                    "model_folder": _current_loaded_folder,
                }
            entities = _nn.predict(body.text)
        # NeuroNER may attach numpy scalars; ensure JSON-serializable for the main app.
        return {
            "entities": jsonable_encoder(entities),
            "model": _current_display_name,
            "model_folder": _current_loaded_folder,
        }
    except HTTPException:
        raise
    except Exception as exc:
        sys.stderr.write("predict error: %s\n" % exc)
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail={"error": "predict_failed", "detail": str(exc)},
        ) from exc


def main():
    import uvicorn

    port = int(os.environ.get("PORT") or os.environ.get("NEURONER_HTTP_PORT") or "8765")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
