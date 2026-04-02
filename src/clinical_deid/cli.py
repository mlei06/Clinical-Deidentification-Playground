"""CLI entry point for clinical-deid."""

from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path
from typing import Any

import click

from clinical_deid.domain import AnnotatedDocument, Document, PHISpan

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _tag_replace(text: str, spans: list[PHISpan]) -> str:
    """Replace spans with ``[LABEL]`` tags, right-to-left to preserve offsets."""
    sorted_spans = sorted(spans, key=lambda s: s.start, reverse=True)
    result = text
    for s in sorted_spans:
        result = result[: s.start] + f"[{s.label}]" + result[s.end :]
    return result


def _build_pipeline(
    profile: str,
    config_path: str | None,
    custom_lists_dir: str | None,
    redactor: str,
) -> tuple[Any, dict[str, Any]]:
    """Return ``(pipe_chain, config_dict)``."""
    from clinical_deid.pipes.registry import load_pipeline

    if config_path:
        config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    else:
        from clinical_deid.profiles import get_profile_config

        config = get_profile_config(
            profile, custom_lists_dir=custom_lists_dir, redactor=redactor
        )
    pipeline = load_pipeline(config)
    return pipeline, config


def _process_doc(
    pipeline: Any,
    doc_id: str,
    text: str,
    redactor: str,
) -> dict[str, Any]:
    """Run pipeline on one document and return a result dict."""
    doc = AnnotatedDocument(document=Document(id=doc_id, text=text), spans=[])
    out = pipeline.forward(doc)

    if out.document.text != text:
        output_text = out.document.text
    else:
        output_text = _tag_replace(text, out.spans)

    return {
        "doc_id": doc_id,
        "original_text": text,
        "output_text": output_text,
        "spans": [s.model_dump() for s in out.spans],
    }


# ---------------------------------------------------------------------------
# CLI group
# ---------------------------------------------------------------------------


@click.group()
@click.version_option(package_name="clinical-deid-playground")
@click.option("--verbose", "-v", is_flag=True, help="Enable debug logging.")
def main(verbose: bool) -> None:
    """Clinical de-identification toolkit."""
    level = logging.DEBUG if verbose else logging.WARNING
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


# ---------------------------------------------------------------------------
# run
# ---------------------------------------------------------------------------


@main.command()
@click.option(
    "--profile",
    "-p",
    type=click.Choice(["fast", "balanced", "accurate"]),
    default="balanced",
    show_default=True,
    help="Pipeline profile (speed vs accuracy trade-off).",
)
@click.option(
    "--config",
    "config_path",
    type=click.Path(exists=True),
    default=None,
    help="Custom pipeline JSON (overrides --profile).",
)
@click.option(
    "--redactor",
    type=click.Choice(["tag", "surrogate"]),
    default="tag",
    show_default=True,
    help="tag=[LABEL] replacement, surrogate=realistic fake data.",
)
@click.option(
    "--format",
    "output_format",
    type=click.Choice(["text", "json", "jsonl"]),
    default="text",
    show_default=True,
)
@click.option("--custom-lists-dir", type=click.Path(exists=True), default=None)
@click.argument("files", nargs=-1, type=click.Path(exists=True))
def run(
    profile: str,
    config_path: str | None,
    redactor: str,
    output_format: str,
    custom_lists_dir: str | None,
    files: tuple[str, ...],
) -> None:
    """De-identify text from stdin or files.

    \b
    Examples:
      echo "Patient John Smith DOB 01/15/1980" | clinical-deid run
      clinical-deid run notes.txt
      clinical-deid run --profile fast --redactor surrogate notes.txt
    """
    pipeline, config = _build_pipeline(profile, config_path, custom_lists_dir, redactor)

    texts: list[tuple[str, str]] = []
    if files:
        for f in files:
            p = Path(f)
            texts.append((p.stem, p.read_text(encoding="utf-8")))
    else:
        if sys.stdin.isatty():
            click.echo("Reading from stdin (Ctrl+D to end)...", err=True)
        texts.append(("stdin", sys.stdin.read()))

    t0 = time.perf_counter()
    from clinical_deid.export import ProcessedResult

    results: list[ProcessedResult] = []
    for doc_id, text in texts:
        r = _process_doc(pipeline, doc_id, text, redactor)
        results.append(
            ProcessedResult(
                doc_id=r["doc_id"],
                original_text=r["original_text"],
                output_text=r["output_text"],
                spans=r["spans"],
                metadata={},
            )
        )
    duration = time.perf_counter() - t0

    from clinical_deid.export import to_json, to_jsonl, to_text

    if output_format == "text":
        click.echo(to_text(results))
    elif output_format == "json":
        click.echo(to_json(results))
    elif output_format == "jsonl":
        click.echo(to_jsonl(results))

    # Audit
    try:
        from clinical_deid.audit import log_run, make_record

        record = make_record(
            command="run",
            profile=profile if not config_path else None,
            config=config,
            doc_count=len(texts),
            error_count=0,
            duration_seconds=duration,
        )
        log_run(record)
    except Exception:
        logger.debug("Failed to write audit record", exc_info=True)


# ---------------------------------------------------------------------------
# batch
# ---------------------------------------------------------------------------


@main.command()
@click.argument("input_path", type=click.Path(exists=True))
@click.option("-o", "--output", "output_dir", type=click.Path(), required=True)
@click.option(
    "--profile",
    "-p",
    type=click.Choice(["fast", "balanced", "accurate"]),
    default="balanced",
    show_default=True,
)
@click.option(
    "--on-error",
    type=click.Choice(["skip", "fail"]),
    default="skip",
    show_default=True,
    help="skip=log error and continue, fail=abort on first error.",
)
@click.option(
    "--format",
    "output_format",
    type=click.Choice(["text", "json", "jsonl", "csv", "parquet"]),
    default="text",
    show_default=True,
)
@click.option(
    "--redactor",
    type=click.Choice(["tag", "surrogate"]),
    default="tag",
    show_default=True,
)
@click.option("--config", "config_path", type=click.Path(exists=True), default=None)
@click.option("--custom-lists-dir", type=click.Path(exists=True), default=None)
def batch(
    input_path: str,
    output_dir: str,
    profile: str,
    on_error: str,
    output_format: str,
    redactor: str,
    config_path: str | None,
    custom_lists_dir: str | None,
) -> None:
    """Process a directory of .txt files or a JSONL file.

    \b
    Examples:
      clinical-deid batch notes_dir/ -o output/ --on-error skip
      clinical-deid batch corpus.jsonl -o output/ --format jsonl
    """
    pipeline, config = _build_pipeline(profile, config_path, custom_lists_dir, redactor)

    # Load input documents
    inp = Path(input_path)
    texts: list[tuple[str, str]] = []
    if inp.is_dir():
        for f in sorted(inp.glob("*.txt")):
            texts.append((f.stem, f.read_text(encoding="utf-8")))
    elif inp.suffix == ".jsonl":
        for i, line in enumerate(inp.read_text(encoding="utf-8").splitlines()):
            if not line.strip():
                continue
            obj = json.loads(line)
            doc_id = obj.get("id") or obj.get("document", {}).get("id") or f"line_{i}"
            text = obj.get("text") or obj.get("document", {}).get("text", "")
            texts.append((str(doc_id), text))
    else:
        texts.append((inp.stem, inp.read_text(encoding="utf-8")))

    if not texts:
        click.echo("No documents found.", err=True)
        raise SystemExit(1)

    click.echo(f"Processing {len(texts)} document(s)...", err=True)

    from clinical_deid.export import ProcessedResult, write_results

    t0 = time.perf_counter()
    results: list[ProcessedResult] = []
    errors: list[dict[str, Any]] = []

    for doc_id, text in texts:
        try:
            r = _process_doc(pipeline, doc_id, text, redactor)
            results.append(
                ProcessedResult(
                    doc_id=r["doc_id"],
                    original_text=r["original_text"],
                    output_text=r["output_text"],
                    spans=r["spans"],
                    metadata={},
                )
            )
        except Exception as exc:
            if on_error == "fail":
                raise
            logger.warning("Error processing %s: %s", doc_id, exc)
            errors.append({"doc_id": doc_id, "error": str(exc)})

    duration = time.perf_counter() - t0

    # Write results
    out = Path(output_dir)
    write_results(results, out, output_format)

    # Write errors if any
    if errors:
        errors_path = out / "errors.jsonl"
        errors_path.write_text(
            "\n".join(json.dumps(e) for e in errors) + "\n", encoding="utf-8"
        )

    # Summary
    click.echo(
        f"Done: {len(results)} processed, {len(errors)} errors, "
        f"{duration:.1f}s total",
        err=True,
    )

    # Audit
    try:
        from clinical_deid.audit import log_run, make_record

        record = make_record(
            command="batch",
            profile=profile if not config_path else None,
            config=config,
            doc_count=len(results),
            error_count=len(errors),
            duration_seconds=duration,
        )
        log_run(record)
    except Exception:
        logger.debug("Failed to write audit record", exc_info=True)


# ---------------------------------------------------------------------------
# eval
# ---------------------------------------------------------------------------


@main.command(name="eval")
@click.option(
    "--corpus",
    required=True,
    type=click.Path(exists=True),
    help="Gold-standard corpus (JSONL or brat dir).",
)
@click.option(
    "--corpus-format",
    type=click.Choice(["jsonl", "brat-dir", "brat-corpus"]),
    default="jsonl",
    show_default=True,
)
@click.option(
    "--profile",
    "-p",
    type=click.Choice(["fast", "balanced", "accurate"]),
    default="balanced",
    show_default=True,
)
@click.option("--config", "config_path", type=click.Path(exists=True), default=None)
@click.option("--custom-lists-dir", type=click.Path(exists=True), default=None)
@click.option(
    "--confidence-threshold",
    type=float,
    default=0.5,
    show_default=True,
    help="Flag spans below this confidence.",
)
@click.option(
    "--redactor",
    type=click.Choice(["tag", "surrogate"]),
    default="tag",
    show_default=True,
)
def eval_cmd(
    corpus: str,
    corpus_format: str,
    profile: str,
    config_path: str | None,
    custom_lists_dir: str | None,
    confidence_threshold: float,
    redactor: str,
) -> None:
    """Evaluate pipeline against a gold-standard corpus.

    \b
    Examples:
      clinical-deid eval --corpus data.jsonl --profile fast
      clinical-deid eval --corpus data.jsonl --custom-lists-dir my_lists/
    """
    from clinical_deid.eval.spans import (
        collect_low_confidence_spans,
        strict_eval_report,
    )
    from clinical_deid.ingest.sources import load_annotated_corpus

    # Load gold corpus
    corpus_path = Path(corpus)
    fmt_map = {
        "jsonl": {"jsonl": corpus_path},
        "brat-dir": {"brat_dir": corpus_path},
        "brat-corpus": {"brat_corpus": corpus_path},
    }
    golds = load_annotated_corpus(**fmt_map[corpus_format])

    if not golds:
        click.echo("No documents in corpus.", err=True)
        raise SystemExit(1)

    click.echo(f"Evaluating on {len(golds)} document(s)...", err=True)

    pipeline, config = _build_pipeline(profile, config_path, custom_lists_dir, redactor)

    t0 = time.perf_counter()
    preds: list[AnnotatedDocument] = []
    for gold in golds:
        empty = AnnotatedDocument(document=gold.document, spans=[])
        preds.append(pipeline.forward(empty))
    duration = time.perf_counter() - t0

    report = strict_eval_report(preds, golds)

    # Print per-label table
    click.echo("")
    header = f"{'Label':<20} {'Prec':>8} {'Recall':>8} {'F1':>8} {'TP':>6} {'FP':>6} {'FN':>6}"
    click.echo(header)
    click.echo("-" * len(header))
    for lm in report.per_label:
        click.echo(
            f"{lm.label:<20} {lm.precision:>8.4f} {lm.recall:>8.4f} {lm.f1:>8.4f} "
            f"{lm.tp:>6} {lm.fp:>6} {lm.fn:>6}"
        )
    click.echo("-" * len(header))
    m = report.micro
    click.echo(
        f"{'MICRO (all)':<20} {m.precision:>8.4f} {m.recall:>8.4f} {m.f1:>8.4f} "
        f"{m.tp:>6} {m.fp:>6} {m.fn:>6}"
    )

    # Low-confidence spans
    low_conf = collect_low_confidence_spans(preds, threshold=confidence_threshold)
    if low_conf:
        click.echo(f"\nLow-confidence spans (< {confidence_threshold}): {len(low_conf)} flagged")
        for doc_id, span, surface in low_conf[:20]:
            click.echo(
                f"  doc {doc_id!r}: [{span.start}:{span.end}] "
                f"{surface!r} ({span.label}, conf={span.confidence:.2f}, source={span.source})"
            )
        if len(low_conf) > 20:
            click.echo(f"  ... and {len(low_conf) - 20} more")

    click.echo(f"\nEval completed in {duration:.1f}s on {len(golds)} doc(s).")

    # Audit
    try:
        from clinical_deid.audit import log_run, make_record

        record = make_record(
            command="eval",
            profile=profile if not config_path else None,
            config=config,
            doc_count=len(golds),
            error_count=0,
            duration_seconds=duration,
            metrics={
                "micro_precision": m.precision,
                "micro_recall": m.recall,
                "micro_f1": m.f1,
            },
        )
        log_run(record)
    except Exception:
        logger.debug("Failed to write audit record", exc_info=True)


# ---------------------------------------------------------------------------
# audit
# ---------------------------------------------------------------------------


@main.group()
def audit() -> None:
    """Audit trail commands."""


@audit.command(name="list")
@click.option("--limit", type=int, default=20, show_default=True)
def audit_list(limit: int) -> None:
    """List recent audit records."""
    from clinical_deid.audit import list_runs

    records = list_runs(limit=limit)
    if not records:
        click.echo("No audit records found.")
        return

    header = (
        f"{'Run ID':<12} {'Timestamp':<22} {'User':<12} {'Cmd':<8} "
        f"{'Profile':<12} {'Docs':>6} {'Errs':>6} {'Duration':>10} {'Recall':>8}"
    )
    click.echo(header)
    click.echo("-" * len(header))
    for r in records:
        recall = ""
        if r.metrics_json:
            metrics = json.loads(r.metrics_json)
            if "micro_recall" in metrics:
                recall = f"{metrics['micro_recall']:.3f}"
        click.echo(
            f"{r.run_id[:12]:<12} {r.timestamp[:22]:<22} {r.user:<12} "
            f"{r.command:<8} {(r.profile or '-'):<12} {r.doc_count:>6} "
            f"{r.error_count:>6} {r.duration_seconds:>9.1f}s {recall:>8}"
        )


@audit.command(name="show")
@click.argument("run_id")
def audit_show(run_id: str) -> None:
    """Show details of a specific run."""
    from clinical_deid.audit import get_run

    record = get_run(run_id)
    if record is None:
        click.echo(f"No record found for {run_id!r}.", err=True)
        raise SystemExit(1)

    click.echo(f"Run ID:    {record.run_id}")
    click.echo(f"Timestamp: {record.timestamp}")
    click.echo(f"User:      {record.user}")
    click.echo(f"Command:   {record.command}")
    click.echo(f"Profile:   {record.profile or '-'}")
    click.echo(f"Docs:      {record.doc_count}")
    click.echo(f"Errors:    {record.error_count}")
    click.echo(f"Duration:  {record.duration_seconds:.1f}s")
    if record.metrics_json:
        click.echo(f"Metrics:   {record.metrics_json}")
    if record.notes:
        click.echo(f"Notes:     {record.notes}")
    click.echo(f"\nPipeline config:\n{record.config_json}")


# ---------------------------------------------------------------------------
# setup
# ---------------------------------------------------------------------------


@main.command()
@click.option("--check", is_flag=True, help="Verify dependencies without installing.")
def setup(check: bool) -> None:
    """Interactive setup: verify dependencies, download models, initialize database.

    \b
    Steps:
      1. Check Python version (require 3.11+)
      2. Check/install spaCy model (en_core_web_sm)
      3. Check Presidio availability
      4. Create .env from .env.example if missing
      5. Initialize SQLite database
      6. Smoke test (run RegexNER on sample text)
    """
    import shutil
    import subprocess

    ok_count = 0
    fail_count = 0

    def status(name: str, ok: bool, detail: str = "") -> None:
        nonlocal ok_count, fail_count
        symbol = "OK" if ok else "FAIL"
        msg = f"  [{symbol}] {name}"
        if detail:
            msg += f" — {detail}"
        click.echo(msg)
        if ok:
            ok_count += 1
        else:
            fail_count += 1

    click.echo("Clinical De-Identification Playground — Setup\n")

    # 1. Python version
    py_ok = sys.version_info >= (3, 11)
    status(
        "Python version",
        py_ok,
        f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        + ("" if py_ok else " (need 3.11+)"),
    )

    # 2. spaCy model
    spacy_model_ok = False
    try:
        import spacy

        try:
            spacy.load("en_core_web_sm")
            spacy_model_ok = True
            status("spaCy en_core_web_sm", True, "loaded")
        except OSError:
            if check:
                status("spaCy en_core_web_sm", False, "not installed")
            else:
                click.echo("  Downloading en_core_web_sm...")
                result = subprocess.run(
                    [sys.executable, "-m", "spacy", "download", "en_core_web_sm"],
                    capture_output=True,
                    text=True,
                )
                if result.returncode == 0:
                    spacy_model_ok = True
                    status("spaCy en_core_web_sm", True, "downloaded")
                else:
                    status("spaCy en_core_web_sm", False, "download failed")
    except ImportError:
        status("spaCy", False, "not installed (pip install '.[ner]')")

    # 3. Presidio
    try:
        import presidio_analyzer  # noqa: F401

        status("Presidio analyzer", True, "installed")
    except ImportError:
        status("Presidio analyzer", False, "not installed (pip install '.[presidio]')")

    # 4. .env file
    env_path = Path(".env")
    example_path = Path(".env.example")
    if env_path.exists():
        status(".env file", True, "exists")
    elif example_path.exists() and not check:
        shutil.copy2(example_path, env_path)
        status(".env file", True, "created from .env.example")
    elif example_path.exists():
        status(".env file", False, "missing (run without --check to create)")
    else:
        status(".env file", False, "no .env.example found")

    # 5. Database
    if not check:
        try:
            from clinical_deid.db import init_db

            init_db()
            status("SQLite database", True, "initialized")
        except Exception as exc:
            status("SQLite database", False, str(exc))
    else:
        from clinical_deid.config import get_settings

        settings = get_settings()
        db_path = settings.sqlite_path
        if db_path and db_path.exists():
            status("SQLite database", True, f"exists at {db_path}")
        else:
            status("SQLite database", False, "not initialized (run without --check)")

    # 6. Smoke test
    if not check:
        try:
            from clinical_deid.domain import AnnotatedDocument, Document
            from clinical_deid.pipes.registry import load_pipe

            pipe = load_pipe({"type": "regex_ner"})
            doc = AnnotatedDocument(
                document=Document(id="smoke", text="Patient John Smith DOB 01/15/1980"),
                spans=[],
            )
            result = pipe.forward(doc)
            if result.spans:
                status("Smoke test", True, f"RegexNER found {len(result.spans)} span(s)")
            else:
                status("Smoke test", True, "RegexNER ran (0 spans — patterns may not match sample)")
        except Exception as exc:
            status("Smoke test", False, str(exc))
    else:
        status("Smoke test", True, "skipped in --check mode")

    click.echo(f"\n{ok_count} passed, {fail_count} failed")
    if fail_count > 0:
        raise SystemExit(1)


# ---------------------------------------------------------------------------
# serve
# ---------------------------------------------------------------------------


@main.command()
@click.option("--host", default="127.0.0.1", show_default=True, help="Bind address.")
@click.option("--port", "-p", default=8000, show_default=True, type=int, help="Port number.")
@click.option("--reload", "do_reload", is_flag=True, help="Enable auto-reload for development.")
@click.option("--workers", default=1, show_default=True, type=int, help="Number of worker processes.")
def serve(host: str, port: int, do_reload: bool, workers: int) -> None:
    """Start the FastAPI server (uvicorn).

    \b
    Examples:
      clinical-deid serve
      clinical-deid serve --port 9000 --reload
      clinical-deid serve --host 0.0.0.0 --workers 4
    """
    try:
        import uvicorn
    except ImportError:
        click.echo(
            "uvicorn is required to serve the API. Install with:\n"
            "  pip install uvicorn[standard]",
            err=True,
        )
        raise SystemExit(1)

    click.echo(f"Starting server on {host}:{port}...", err=True)
    uvicorn.run(
        "clinical_deid.api.app:app",
        host=host,
        port=port,
        reload=do_reload,
        workers=workers,
    )
