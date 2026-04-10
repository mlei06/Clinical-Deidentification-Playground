"""CLI entry point for clinical-deid."""

from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path
from typing import Any

import click

from clinical_deid.domain import AnnotatedDocument, Document, PHISpan, tag_replace
from clinical_deid.export import ProcessedResult

logger = logging.getLogger(__name__)


def _build_pipeline(
    profile: str,
    config_path: str | None,
    pipeline_name: str | None,
    redactor: str,
) -> tuple[Any, dict[str, Any], str]:
    """Return ``(pipe_chain, config_dict, resolved_pipeline_name)``."""
    from clinical_deid.pipes.registry import load_pipeline, registered_pipes

    # Early check: if surrogate redactor requested, verify faker is available
    if redactor == "surrogate" and "surrogate" not in registered_pipes():
        click.echo(
            "Error: --redactor surrogate requires the faker library.\n"
            "Install it with:  pip install 'clinical-deid-playground[scripts]'",
            err=True,
        )
        raise SystemExit(1)

    resolved_name = ""

    if pipeline_name:
        # Load from saved pipeline file
        from clinical_deid.config import get_settings
        from clinical_deid.pipeline_store import load_pipeline_config

        try:
            config = load_pipeline_config(get_settings().pipelines_dir, pipeline_name)
        except FileNotFoundError as exc:
            click.echo(f"Error: {exc}", err=True)
            raise SystemExit(1)
        resolved_name = pipeline_name
    elif config_path:
        config = json.loads(Path(config_path).read_text(encoding="utf-8"))
        resolved_name = Path(config_path).stem
    else:
        from clinical_deid.profiles import get_profile_config

        config = get_profile_config(profile, redactor=redactor)
        resolved_name = f"profile:{profile}"

    try:
        pipeline = load_pipeline(config)
    except RuntimeError as exc:
        click.echo(f"Error: {exc}", err=True)
        raise SystemExit(1)

    return pipeline, config, resolved_name


def _process_doc(
    pipeline: Any,
    doc_id: str,
    text: str,
    redactor: str,
) -> ProcessedResult:
    """Run pipeline on one document and return a ProcessedResult."""
    doc = AnnotatedDocument(document=Document(id=doc_id, text=text), spans=[])
    out = pipeline.forward(doc)

    if out.document.text != text:
        output_text = out.document.text
    else:
        output_text = tag_replace(text, out.spans)

    return ProcessedResult(
        doc_id=doc_id,
        original_text=text,
        output_text=output_text,
        spans=[s.model_dump() for s in out.spans],
        metadata={},
    )


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
    "--pipeline",
    "pipeline_name",
    default=None,
    help="Name of a saved pipeline (overrides --profile and --config).",
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
@click.argument("files", nargs=-1, type=click.Path(exists=True))
def run(
    profile: str,
    config_path: str | None,
    pipeline_name: str | None,
    redactor: str,
    output_format: str,
    files: tuple[str, ...],
) -> None:
    """De-identify text from stdin or files.

    \b
    Examples:
      echo "Patient John Smith DOB 01/15/1980" | clinical-deid run
      clinical-deid run notes.txt
      clinical-deid run --pipeline my-pipeline notes.txt
      clinical-deid run --profile fast --redactor surrogate notes.txt
    """
    pipeline, config, resolved_name = _build_pipeline(
        profile, config_path, pipeline_name, redactor
    )

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
    results = [_process_doc(pipeline, doc_id, text, redactor) for doc_id, text in texts]
    duration = time.perf_counter() - t0

    from clinical_deid.export import to_json, to_jsonl, to_text

    if output_format == "text":
        click.echo(to_text(results))
    elif output_format == "json":
        click.echo(to_json(results))
    elif output_format == "jsonl":
        click.echo(to_jsonl(results))

    # Audit
    total_spans = sum(len(r.spans) for r in results)
    try:
        from clinical_deid.audit import log_run

        log_run(
            command="run",
            pipeline_name=resolved_name,
            pipeline_config=config,
            doc_count=len(texts),
            error_count=0,
            span_count=total_spans,
            duration_seconds=duration,
            source="cli",
        )
    except Exception:
        logger.warning("Failed to write audit record", exc_info=True)


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
    "--pipeline",
    "pipeline_name",
    default=None,
    help="Name of a saved pipeline (overrides --profile and --config).",
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
def batch(
    input_path: str,
    output_dir: str,
    profile: str,
    pipeline_name: str | None,
    on_error: str,
    output_format: str,
    redactor: str,
    config_path: str | None,
) -> None:
    """Process a directory of .txt files or a JSONL file.

    \b
    Examples:
      clinical-deid batch notes_dir/ -o output/ --on-error skip
      clinical-deid batch corpus.jsonl -o output/ --format jsonl
      clinical-deid batch notes_dir/ -o output/ --pipeline my-pipeline
    """
    pipeline, config, resolved_name = _build_pipeline(
        profile, config_path, pipeline_name, redactor
    )

    # Load input documents
    inp = Path(input_path)
    texts: list[tuple[str, str]] = []
    if inp.is_dir():
        for f in sorted(inp.glob("*.txt")):
            texts.append((f.stem, f.read_text(encoding="utf-8")))
    elif inp.suffix == ".jsonl":
        with open(inp, encoding="utf-8") as fh:
            for i, line in enumerate(fh):
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

    from clinical_deid.export import write_results

    t0 = time.perf_counter()
    results: list[ProcessedResult] = []
    errors: list[dict[str, Any]] = []

    for doc_id, text in texts:
        try:
            results.append(_process_doc(pipeline, doc_id, text, redactor))
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
    total_spans = sum(len(r.spans) for r in results)
    try:
        from clinical_deid.audit import log_run

        log_run(
            command="batch",
            pipeline_name=resolved_name,
            pipeline_config=config,
            dataset_source=input_path,
            doc_count=len(results),
            error_count=len(errors),
            span_count=total_spans,
            duration_seconds=duration,
            source="cli",
        )
    except Exception:
        logger.warning("Failed to write audit record", exc_info=True)


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
@click.option(
    "--pipeline",
    "pipeline_name",
    default=None,
    help="Name of a saved pipeline (overrides --profile and --config).",
)
@click.option("--config", "config_path", type=click.Path(exists=True), default=None)
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
    pipeline_name: str | None,
    config_path: str | None,
    confidence_threshold: float,
    redactor: str,
) -> None:
    """Evaluate pipeline against a gold-standard corpus.

    Shows strict, partial-overlap, and token-level metrics plus risk-weighted
    recall and HIPAA coverage gaps.

    \b
    Examples:
      clinical-deid eval --corpus data.jsonl --profile fast
      clinical-deid eval --corpus data.jsonl --pipeline my-pipeline
    """
    from clinical_deid.eval.risk import HIPAA_IDENTIFIER_NAMES, hipaa_coverage_report
    from clinical_deid.eval.runner import evaluate_pipeline
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

    pipeline, config, resolved_name = _build_pipeline(
        profile, config_path, pipeline_name, redactor
    )

    t0 = time.perf_counter()
    result = evaluate_pipeline(pipeline, golds)
    duration = time.perf_counter() - t0

    # ---- Per-label table (strict match) ----
    click.echo("")
    header = f"{'Label':<20} {'Prec':>8} {'Recall':>8} {'F1':>8} {'TP':>6} {'FP':>6} {'FN':>6} {'Support':>8}"
    click.echo(header)
    click.echo("-" * len(header))
    for label in sorted(result.per_label):
        lm = result.per_label[label]
        s = lm.strict
        click.echo(
            f"{label:<20} {s.precision:>8.4f} {s.recall:>8.4f} {s.f1:>8.4f} "
            f"{s.tp:>6} {s.fp:>6} {s.fn:>6} {lm.support:>8}"
        )
    click.echo("-" * len(header))
    o = result.overall
    click.echo(
        f"{'MICRO (all)':<20} {o.strict.precision:>8.4f} {o.strict.recall:>8.4f} {o.strict.f1:>8.4f} "
        f"{o.strict.tp:>6} {o.strict.fp:>6} {o.strict.fn:>6}"
    )

    # ---- Summary across matching modes ----
    click.echo(f"\n{'Matching mode':<25} {'Prec':>8} {'Recall':>8} {'F1':>8}")
    click.echo("-" * 51)
    for mode_name, mr in [
        ("Strict", o.strict),
        ("Partial overlap", o.partial_overlap),
        ("Token-level", o.token_level),
        ("Exact boundary", o.exact_boundary),
    ]:
        click.echo(f"{mode_name:<25} {mr.precision:>8.4f} {mr.recall:>8.4f} {mr.f1:>8.4f}")
    click.echo(f"\n  Risk-weighted recall:  {result.risk_weighted_recall:.4f}")

    # ---- HIPAA coverage ----
    pipeline_labels: set[str] = set()
    for lm in result.per_label.values():
        pipeline_labels.add(lm.label)
    coverage = hipaa_coverage_report(pipeline_labels)
    uncovered = [
        (hid, HIPAA_IDENTIFIER_NAMES[hid])
        for hid, status in coverage.items()
        if status == "uncovered"
    ]
    if uncovered:
        click.echo(f"\n  HIPAA gaps ({len(uncovered)} uncovered):")
        for hid, name in uncovered:
            click.echo(f"    #{hid}: {name}")
    else:
        click.echo("\n  HIPAA: all applicable identifiers covered")

    # ---- Low-confidence spans (from false positives per doc) ----
    low_conf: list[tuple[str, PHISpan]] = []
    for dr in result.document_results:
        for span in dr.false_positives:
            if span.confidence is not None and span.confidence < confidence_threshold:
                low_conf.append((dr.document_id, span))
    if low_conf:
        click.echo(f"\n  Low-confidence false positives (conf < {confidence_threshold}): {len(low_conf)} flagged")
        for doc_id, span in low_conf[:20]:
            click.echo(
                f"    doc {doc_id!r}: [{span.start}:{span.end}] "
                f"({span.label}, conf={span.confidence:.2f}, src={span.source})"
            )
        if len(low_conf) > 20:
            click.echo(f"    ... and {len(low_conf) - 20} more")

    # ---- Worst documents ----
    worst = result.document_results[:3]
    if worst and worst[0].metrics.strict.f1 < 1.0:
        click.echo(f"\n  Worst documents (by strict F1):")
        for dr in worst:
            click.echo(
                f"    {dr.document_id}: F1={dr.metrics.strict.f1:.4f}  "
                f"FN={len(dr.false_negatives)}  FP={len(dr.false_positives)}  "
                f"risk_recall={dr.risk_weighted_recall:.4f}"
            )

    click.echo(f"\nEval completed in {duration:.1f}s on {result.document_count} doc(s).")

    # Audit
    try:
        from clinical_deid.audit import log_run

        log_run(
            command="eval",
            pipeline_name=resolved_name,
            pipeline_config=config,
            dataset_source=corpus,
            doc_count=result.document_count,
            error_count=0,
            span_count=o.strict.tp + o.strict.fp,
            duration_seconds=duration,
            metrics={
                "strict_precision": o.strict.precision,
                "strict_recall": o.strict.recall,
                "strict_f1": o.strict.f1,
                "partial_f1": o.partial_overlap.f1,
                "token_f1": o.token_level.f1,
                "risk_weighted_recall": result.risk_weighted_recall,
            },
            source="cli",
        )
    except Exception:
        logger.warning("Failed to write audit record", exc_info=True)


# ---------------------------------------------------------------------------
# audit
# ---------------------------------------------------------------------------


@main.group()
def audit() -> None:
    """Audit trail commands."""


@audit.command(name="list")
@click.option("--limit", type=int, default=20, show_default=True)
@click.option("--source", type=click.Choice(["cli", "api"]), default=None)
def audit_list(limit: int, source: str | None) -> None:
    """List recent audit records."""
    from clinical_deid.audit import list_runs

    records = list_runs(limit=limit, source=source)
    if not records:
        click.echo("No audit records found.")
        return

    header = (
        f"{'ID':<12} {'Timestamp':<20} {'User':<10} {'Cmd':<8} "
        f"{'Pipeline':<20} {'Src':<5} {'Docs':>5} {'Spans':>7} {'Time':>8}"
    )
    click.echo(header)
    click.echo("-" * len(header))
    for r in records:
        ts = r.timestamp.strftime("%Y-%m-%d %H:%M:%S") if r.timestamp else ""
        click.echo(
            f"{r.id[:12]:<12} {ts:<20} {r.user:<10} "
            f"{r.command:<8} {r.pipeline_name[:20]:<20} {r.source:<5} "
            f"{r.doc_count:>5} {r.span_count:>7} {r.duration_seconds:>7.1f}s"
        )


@audit.command(name="show")
@click.argument("record_id")
def audit_show(record_id: str) -> None:
    """Show details of a specific audit record."""
    from clinical_deid.audit import get_run

    record = get_run(record_id)
    if record is None:
        click.echo(f"No record found for {record_id!r}.", err=True)
        raise SystemExit(1)

    ts = record.timestamp.strftime("%Y-%m-%d %H:%M:%S") if record.timestamp else ""
    click.echo(f"ID:            {record.id}")
    click.echo(f"Timestamp:     {ts}")
    click.echo(f"User:          {record.user}")
    click.echo(f"Command:       {record.command}")
    click.echo(f"Pipeline:      {record.pipeline_name}")
    click.echo(f"Source:        {record.source}")
    click.echo(f"Docs:          {record.doc_count}")
    click.echo(f"Errors:        {record.error_count}")
    click.echo(f"Spans:         {record.span_count}")
    click.echo(f"Duration:      {record.duration_seconds:.1f}s")
    if record.dataset_source:
        click.echo(f"Dataset:       {record.dataset_source}")
    if record.metrics:
        click.echo(f"Metrics:       {json.dumps(record.metrics, indent=2)}")
    if record.notes:
        click.echo(f"Notes:         {record.notes}")
    click.echo(f"\nPipeline config:\n{json.dumps(record.pipeline_config, indent=2)}")


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
