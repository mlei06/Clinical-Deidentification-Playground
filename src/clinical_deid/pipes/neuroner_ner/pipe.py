"""NeuroNER LSTM-CRF detector pipe (subprocess bridge).

Runs the NeuroNER TensorFlow 1.x model in a separate Python 3.7 process and
communicates via line-delimited JSON on stdin/stdout.
"""

from __future__ import annotations

import concurrent.futures
import json
import logging
import subprocess
import threading
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from clinical_deid.domain import AnnotatedDocument, PHISpan
from clinical_deid.pipes.base import ConfigurablePipe
from clinical_deid.pipes.detector_label_mapping import (
    accumulate_spans,
    apply_detector_label_mapping,
    detector_label_mapping_field,
    effective_detector_labels,
)
from clinical_deid.pipes.ui_schema import field_ui

logger = logging.getLogger(__name__)

_WORKER_SCRIPT = str(Path(__file__).with_name("_worker.py"))


# ── Runtime availability check (called by registry.pipe_availability) ─────

def check_neuroner_ready() -> tuple[bool, dict[str, Any]]:
    """Check whether the NeuroNER runtime prerequisites are satisfied.

    Returns ``(all_ok, details)`` where *details* has per-component status:

    - **venv_python**: Python 3.7 interpreter exists at the expected path
    - **models**: at least one model directory exists in ``models/neuroner/``
    - **embeddings**: GloVe embedding file exists at the expected path

    Uses the same default paths as :class:`NeuroNerConfig`.
    """
    venv = Path("neuroner-cspmc/venv/bin/python").resolve()
    models_dir = Path("models/neuroner").resolve()
    embedding = Path("data/word_vectors/glove.6B.100d.txt").resolve()

    venv_ok = venv.exists() and venv.is_file()
    models_found = (
        sorted(p.name for p in models_dir.iterdir() if p.is_dir())
        if models_dir.exists()
        else []
    )
    models_ok = len(models_found) > 0
    embedding_ok = embedding.exists() and embedding.is_file()

    details: dict[str, Any] = {
        "venv_python": {
            "ok": venv_ok,
            "path": str(venv),
        },
        "models": {
            "ok": models_ok,
            "path": str(models_dir),
            "found": models_found,
        },
        "embeddings": {
            "ok": embedding_ok,
            "path": str(embedding),
        },
    }
    return (venv_ok and models_ok and embedding_ok), details


# ── Default entity mapping: neuroner i2b2 labels → clinical-deid labels ──

DEFAULT_ENTITY_MAP: dict[str, str] = {
    # Person names
    "DOCTOR": "NAME",
    "PATIENT": "NAME",
    "USERNAME": "NAME",
    # Dates / age
    "DATE": "DATE",
    "AGE": "AGE",
    # Locations
    "HOSPITAL": "HOSPITAL",
    "CITY": "LOCATION",
    "STATE": "LOCATION",
    "COUNTRY": "LOCATION",
    "STREET": "LOCATION",
    "ZIP": "LOCATION",
    "LOCATION_OTHER": "LOCATION",
    "ORGANIZATION": "ORGANIZATION",
    # Identifiers
    "MEDICALRECORD": "ID",
    "IDNUM": "ID",
    "BIOID": "ID",
    "DEVICE": "ID",
    "HEALTHPLAN": "ID",
    # Contact
    "PHONE": "PHONE",
    "FAX": "PHONE",
    "EMAIL": "EMAIL",
    "URL": "URL",
    # Professional
    "PROFESSION": "PROFESSION",
}


class NeuroNerConfig(BaseModel):
    """Configuration for the NeuroNER LSTM-CRF detector pipe.

    The model runs in a persistent Python 3.7 subprocess (TF1 is incompatible
    with Python 3.11+).  On first ``forward()`` call the subprocess is launched
    and the model is loaded; subsequent calls reuse the warm session.
    """

    model_config = ConfigDict(protected_namespaces=())

    model: str = Field(
        default="i2b2_2014_glove_spacy_bioes",
        description="Name of the NeuroNER trained model directory.",
        json_schema_extra=field_ui(
            ui_group="Model",
            ui_order=1,
            ui_widget="select",
            ui_help="Model name from models/neuroner/",
        ),
    )

    models_dir: str = Field(
        default="models/neuroner",
        description="Directory containing NeuroNER model folders (relative to CWD or absolute).",
        json_schema_extra=field_ui(
            ui_group="Model",
            ui_order=2,
            ui_widget="text",
            ui_advanced=True,
        ),
    )

    neuroner_root: str = Field(
        default="neuroner-cspmc",
        description="Path to the neuroner-cspmc project root (relative to CWD or absolute).",
        json_schema_extra=field_ui(
            ui_group="Model",
            ui_order=3,
            ui_widget="text",
            ui_advanced=True,
        ),
    )

    venv_python: str = Field(
        default="neuroner-cspmc/venv/bin/python",
        description="Path to the Python 3.7 interpreter in the NeuroNER virtualenv.",
        json_schema_extra=field_ui(
            ui_group="Model",
            ui_order=4,
            ui_widget="text",
            ui_advanced=True,
        ),
    )

    token_embedding: str = Field(
        default="data/word_vectors/glove.6B.100d.txt",
        description="Path to pretrained token embeddings (relative to project root or absolute).",
        json_schema_extra=field_ui(
            ui_group="Model",
            ui_order=5,
            ui_widget="text",
            ui_advanced=True,
        ),
    )

    dataset_text_folder: str = Field(
        default="data/neuroner_deploy",
        description="Path to dataset text folder with deploy/ subfolder (relative to project root or absolute).",
        json_schema_extra=field_ui(
            ui_group="Model",
            ui_order=6,
            ui_widget="text",
            ui_advanced=True,
        ),
    )

    output_folder: str = Field(
        default="output/neuroner",
        description="Directory for NeuroNER output (relative to project root or absolute).",
        json_schema_extra=field_ui(
            ui_group="Model",
            ui_order=7,
            ui_widget="text",
            ui_advanced=True,
        ),
    )

    startup_timeout: float = Field(
        default=120.0,
        description="Maximum seconds to wait for the NeuroNER subprocess to become ready.",
        json_schema_extra=field_ui(
            ui_group="Performance",
            ui_order=1,
            ui_widget="number",
            ui_advanced=True,
        ),
    )

    predict_timeout: float = Field(
        default=60.0,
        description="Maximum seconds to wait for a single prediction.",
        json_schema_extra=field_ui(
            ui_group="Performance",
            ui_order=2,
            ui_widget="number",
            ui_advanced=True,
        ),
    )

    entity_map: dict[str, str] = Field(
        default_factory=lambda: dict(DEFAULT_ENTITY_MAP),
        description=(
            "Map NeuroNER entity labels to project PHI labels. "
            "Unmapped labels pass through as-is."
        ),
        json_schema_extra=field_ui(
            ui_group="Entities & mapping",
            ui_order=1,
            ui_widget="key_value",
        ),
    )

    source_name: str = Field(
        default="neuroner_ner",
        json_schema_extra=field_ui(
            ui_group="General",
            ui_widget="text",
            ui_advanced=True,
        ),
    )

    label_mapping: dict[str, str | None] = detector_label_mapping_field()

    skip_overlapping: bool = Field(
        default=False,
        description="Drop new spans that overlap any existing span in the document.",
        json_schema_extra=field_ui(
            ui_group="General",
            ui_order=99,
            ui_widget="switch",
            ui_advanced=True,
        ),
    )


class NeuroNerPipe(ConfigurablePipe):
    """Detector that delegates to a NeuroNER LSTM-CRF model in a Py3.7 subprocess."""

    def __init__(self, config: NeuroNerConfig | None = None) -> None:
        self._config = config or NeuroNerConfig()
        self._process: subprocess.Popen[str] | None = None
        self._lock = threading.Lock()
        self._model_labels: list[str] | None = None
        self._stderr_thread: threading.Thread | None = None
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)

    # ── Subprocess lifecycle ───────────────────────────────────────────

    def _resolve_paths(self) -> dict[str, str]:
        """Resolve all config paths to absolute strings.

        neuroner_root, venv_python, models_dir resolve relative to CWD.
        token_embedding and dataset_text_folder also resolve relative to CWD
        (not neuroner_root) so that data lives in the project root.
        """
        root = Path(self._config.neuroner_root).resolve()
        venv = Path(self._config.venv_python).resolve()
        models_dir = Path(self._config.models_dir).resolve()
        model_folder = models_dir / self._config.model
        dataset_text = Path(self._config.dataset_text_folder).resolve()
        embedding = Path(self._config.token_embedding).resolve()

        if not venv.exists():
            raise FileNotFoundError(
                f"NeuroNER Python interpreter not found: {venv}\n"
                "Ensure neuroner-cspmc/venv is set up with Python 3.7."
            )
        if not model_folder.exists():
            available = (
                ", ".join(p.name for p in models_dir.iterdir() if p.is_dir())
                if models_dir.exists()
                else "(directory missing)"
            )
            raise FileNotFoundError(
                f"NeuroNER model not found: {model_folder}\n"
                f"Available models in {models_dir}: {available}"
            )
        output = Path(self._config.output_folder).resolve()
        return {
            "neuroner_root": str(root),
            "venv_python": str(venv),
            "model_folder": str(model_folder),
            "dataset_text_folder": str(dataset_text),
            "token_embedding": str(embedding),
            "output_folder": str(output),
        }

    def _ensure_subprocess(self) -> subprocess.Popen[str]:
        """Start the worker subprocess if not already running.  Thread-safe."""
        with self._lock:
            if self._process is not None and self._process.poll() is None:
                return self._process

            paths = self._resolve_paths()
            cmd = [
                paths["venv_python"],
                _WORKER_SCRIPT,
                f"--neuroner_root={paths['neuroner_root']}",
                f"--model_folder={paths['model_folder']}",
                f"--dataset_text_folder={paths['dataset_text_folder']}",
                f"--token_pretrained_embedding_filepath={paths['token_embedding']}",
                f"--output_folder={paths['output_folder']}",
            ]
            logger.info("Starting NeuroNER worker: %s", " ".join(cmd))
            self._process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,  # line-buffered
            )

            # Continuously drain stderr in a background thread so the OS pipe
            # buffer never fills up.  (TensorFlow and NeuroNER emit verbose
            # warnings to stderr; if the buffer fills, the child blocks on
            # write() and deadlocks.)
            self._stderr_thread = threading.Thread(
                target=self._drain_stderr_loop,
                daemon=True,
                name="neuroner-stderr-drain",
            )
            self._stderr_thread.start()

            # Wait for the "ready" message
            ready_line = self._readline_with_timeout(self._config.startup_timeout)
            if ready_line is None:
                self._kill_process()
                raise TimeoutError(
                    f"NeuroNER worker did not become ready within "
                    f"{self._config.startup_timeout}s.  "
                    f"Check logs for 'neuroner worker:' stderr output."
                )

            msg = json.loads(ready_line)
            if msg.get("status") == "error":
                self._kill_process()
                raise RuntimeError(
                    f"NeuroNER worker failed to start: {msg.get('detail', '')}  "
                    f"Check logs for 'neuroner worker:' stderr output."
                )

            self._model_labels = msg.get("labels")
            logger.info(
                "NeuroNER worker ready (model=%s, labels=%s)",
                self._config.model,
                self._model_labels,
            )
            return self._process

    def _readline_with_timeout(self, timeout: float) -> str | None:
        """Read one line from the subprocess stdout with a timeout."""
        assert self._process is not None and self._process.stdout is not None
        future = self._executor.submit(self._process.stdout.readline)
        try:
            return future.result(timeout=timeout)
        except concurrent.futures.TimeoutError:
            return None

    def _drain_stderr_loop(self) -> None:
        """Background loop: read stderr until EOF, logging each line.

        Runs in a daemon thread so the OS pipe buffer never fills up.
        """
        proc = self._process
        if proc is None or proc.stderr is None:
            return
        try:
            for line in proc.stderr:
                line = line.rstrip("\n")
                if line:
                    logger.debug("neuroner worker: %s", line)
        except Exception:
            pass

    def _kill_process(self) -> None:
        if self._process is not None:
            try:
                self._process.kill()
                self._process.wait(timeout=5)
            except Exception:
                pass
            self._process = None

    # ── JSON-RPC communication ─────────────────────────────────────────

    def _send_request(self, request: dict[str, Any]) -> dict[str, Any]:
        """Send a JSON request and read a JSON response.  Thread-safe.

        The lock serializes all stdin writes and stdout reads so that
        concurrent callers cannot interleave requests.  The child process
        is single-threaded (one NeuroNER session), so it processes
        requests sequentially — no additional child-side locking is needed.
        """
        with self._lock:
            proc = self._process
            if proc is None or proc.poll() is not None:
                raise RuntimeError("NeuroNER worker process is not running")

            assert proc.stdin is not None and proc.stdout is not None
            proc.stdin.write(json.dumps(request) + "\n")
            proc.stdin.flush()

            line = self._readline_with_timeout(self._config.predict_timeout)
            if line is None:
                raise TimeoutError(
                    f"NeuroNER worker timed out after {self._config.predict_timeout}s.  "
                    f"Check logs for 'neuroner worker:' stderr output."
                )

            response = json.loads(line)
            if "error" in response:
                raise RuntimeError(
                    f"NeuroNER worker error ({response['error']}): "
                    f"{response.get('detail', '')}"
                )
            return response

    # ── Public API ─────────────────────────────────────────────────────

    def model_labels(self) -> list[str]:
        """Return the entity labels the loaded model can produce.

        These are the *raw* neuroner labels (before ``entity_map``).
        Triggers subprocess startup if not already running.
        """
        self._ensure_subprocess()
        if self._model_labels is not None:
            return list(self._model_labels)
        # Fallback: ask the worker directly
        response = self._send_request({"action": "labels"})
        self._model_labels = response.get("labels", [])
        return list(self._model_labels)

    @property
    def base_labels(self) -> set[str]:
        """Entity labels after ``entity_map`` is applied."""
        m = self._config.entity_map
        return set(m.values()) | set(m.keys())

    @property
    def label_mapping(self) -> dict[str, str | None]:
        return dict(self._config.label_mapping)

    @property
    def labels(self) -> set[str]:
        return effective_detector_labels(self.base_labels, self._config.label_mapping)

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        text = doc.document.text
        if not text.strip():
            return doc

        self._ensure_subprocess()
        response = self._send_request({"action": "predict", "text": text})

        entities = response.get("entities", [])
        found: list[PHISpan] = []
        text_len = len(text)
        for ent in entities:
            raw_label = ent["type"]
            label = self._config.entity_map.get(raw_label, raw_label)
            start, end = ent["start"], ent["end"]
            if 0 <= start < end <= text_len:
                found.append(
                    PHISpan(
                        start=start,
                        end=end,
                        label=label,
                        confidence=None,
                        source=self._config.source_name,
                    )
                )

        found.sort(key=lambda s: (s.start, s.end, s.label))
        found = apply_detector_label_mapping(found, self._config.label_mapping)
        return accumulate_spans(
            doc, found, skip_overlapping=self._config.skip_overlapping
        )

    # ── Cleanup ────────────────────────────────────────────────────────

    def shutdown(self) -> None:
        """Gracefully stop the worker subprocess and release resources."""
        with self._lock:
            if self._process is None or self._process.poll() is not None:
                self._process = None
            else:
                try:
                    assert self._process.stdin is not None
                    self._process.stdin.write(json.dumps({"action": "shutdown"}) + "\n")
                    self._process.stdin.flush()
                    self._process.wait(timeout=10)
                except Exception:
                    self._kill_process()
                self._process = None
        self._executor.shutdown(wait=False)

    def __del__(self) -> None:
        try:
            self.shutdown()
        except Exception:
            pass
