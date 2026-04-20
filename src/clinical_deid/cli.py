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
) -> tuple[Any, dict[str, Any], str]:
    """Return ``(pipe_chain, config_dict, resolved_pipeline_name)``."""
    from clinical_deid.pipes.registry import load_pipeline

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

        config = get_profile_config(profile)
        resolved_name = f"profile:{profile}"

    try:
        pipeline = load_pipeline(config)
    except RuntimeError as exc:
        click.echo(f"Error: {exc}", err=True)
        raise SystemExit(1)

    return pipeline, config, resolved_name


def _apply_output_mode(text: str, spans: list[PHISpan], output_mode: str) -> str:
    """Apply the requested output mode to produce final text."""
    if output_mode == "annotated":
        return text

    if output_mode == "surrogate":
        from clinical_deid.pipes.surrogate.strategies import SurrogateGenerator

        gen = SurrogateGenerator()
        sorted_spans = sorted(spans, key=lambda s: s.start, reverse=True)
        result = text
        for s in sorted_spans:
            original = text[s.start : s.end]
            replacement = gen.replace(s.label, original)
            result = result[: s.start] + replacement + result[s.end :]
        return result

    # Default: tag replacement
    return tag_replace(text, spans)


def _process_doc(
    pipeline: Any,
    doc_id: str,
    text: str,
    output_mode: str,
) -> ProcessedResult:
    """Run pipeline on one document and return a ProcessedResult."""
    doc = AnnotatedDocument(document=Document(id=doc_id, text=text), spans=[])
    out = pipeline.forward(doc)

    output_text = _apply_output_mode(text, out.spans, output_mode)

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
    "--output-mode",
    type=click.Choice(["redacted", "surrogate", "annotated"]),
    default="redacted",
    show_default=True,
    help="redacted=[LABEL] tags, surrogate=fake data, annotated=original text.",
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
    output_mode: str,
    output_format: str,
    files: tuple[str, ...],
) -> None:
    """De-identify text from stdin or files.

    \b
    Examples:
      echo "Patient John Smith DOB 01/15/1980" | clinical-deid run
      clinical-deid run notes.txt
      clinical-deid run --pipeline my-pipeline notes.txt
      clinical-deid run --profile fast --output-mode surrogate notes.txt
    """
    if output_mode == "surrogate":
        from clinical_deid.pipes.registry import registered_pipes

        if "surrogate" not in registered_pipes():
            click.echo(
                "Error: --output-mode surrogate requires the faker library.\n"
                "Install it with:  pip install 'clinical-deid-playground[scripts]'",
                err=True,
            )
            raise SystemExit(1)

    pipeline, config, resolved_name = _build_pipeline(
        profile, config_path, pipeline_name
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
    results = [_process_doc(pipeline, doc_id, text, output_mode) for doc_id, text in texts]
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
    "--output-mode",
    type=click.Choice(["redacted", "surrogate", "annotated"]),
    default="redacted",
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
    output_mode: str,
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
        profile, config_path, pipeline_name
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
            results.append(_process_doc(pipeline, doc_id, text, output_mode))
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
def eval_cmd(
    corpus: str,
    corpus_format: str,
    profile: str,
    pipeline_name: str | None,
    config_path: str | None,
    confidence_threshold: float,
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
        profile, config_path, pipeline_name
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


# ---------------------------------------------------------------------------
# dict (dictionary management)
# ---------------------------------------------------------------------------


@main.group(name="dict")
def dict_group() -> None:
    """Dictionary management (whitelist / blacklist term lists)."""


def _dict_store():
    from clinical_deid.config import get_settings
    from clinical_deid.dictionary_store import DictionaryStore

    return DictionaryStore(get_settings().dictionaries_dir)


@dict_group.command(name="list")
@click.option("--kind", type=click.Choice(["whitelist", "blacklist"]), default=None)
@click.option("--label", default=None, help="Filter by label (whitelist only).")
def dict_list(kind: str | None, label: str | None) -> None:
    """List all dictionaries."""
    store = _dict_store()
    entries = store.list_dictionaries(kind=kind, label=label)
    if not entries:
        click.echo("No dictionaries found.")
        return

    header = f"{'Kind':<12} {'Name':<25} {'Label':<15} {'Terms':>8} {'File'}"
    click.echo(header)
    click.echo("-" * len(header))
    for e in entries:
        lbl = getattr(e, "label", "") or ""
        click.echo(
            f"{e.kind:<12} {e.name:<25} {lbl:<15} {e.term_count:>8} {e.filename}"
        )


@dict_group.command(name="preview")
@click.argument("kind", type=click.Choice(["whitelist", "blacklist"]))
@click.argument("name")
@click.option("--label", default=None, help="Label section (whitelist only).")
@click.option("-n", "count", default=20, show_default=True, help="Number of terms to show.")
def dict_preview(kind: str, name: str, label: str | None, count: int) -> None:
    """Preview terms from a dictionary."""
    store = _dict_store()
    try:
        terms = store.get_terms(kind, name, label=label)
    except FileNotFoundError as exc:
        click.echo(f"Error: {exc}", err=True)
        raise SystemExit(1)

    click.echo(f"{kind}/{name}  ({len(terms)} terms total)")
    for t in terms[:count]:
        click.echo(f"  {t}")
    if len(terms) > count:
        click.echo(f"  ... and {len(terms) - count} more")


@dict_group.command(name="import")
@click.argument("file", type=click.Path(exists=True))
@click.option("--kind", type=click.Choice(["whitelist", "blacklist"]), required=True)
@click.option("--name", required=True, help="Dictionary name.")
@click.option("--label", default=None, help="Label (whitelist only).")
def dict_import(file: str, kind: str, name: str, label: str | None) -> None:
    """Import a dictionary from a local file (txt, csv, or json)."""
    p = Path(file)
    content = p.read_text(encoding="utf-8")
    ext = p.suffix if p.suffix in (".txt", ".csv", ".json") else ".txt"

    store = _dict_store()
    try:
        info = store.save(kind, name, content, label=label, extension=ext)
    except ValueError as exc:
        click.echo(f"Error: {exc}", err=True)
        raise SystemExit(1)

    click.echo(f"Saved {info.term_count} terms to {info.kind}/{info.filename}")


@dict_group.command(name="delete")
@click.argument("kind", type=click.Choice(["whitelist", "blacklist"]))
@click.argument("name")
@click.option("--label", default=None, help="Label section (whitelist only).")
def dict_delete(kind: str, name: str, label: str | None) -> None:
    """Delete a dictionary."""
    store = _dict_store()
    try:
        store.delete(kind, name, label=label)
    except FileNotFoundError as exc:
        click.echo(f"Error: {exc}", err=True)
        raise SystemExit(1)
    click.echo(f"Deleted {kind}/{name}")


# ---------------------------------------------------------------------------
# dataset
# ---------------------------------------------------------------------------


@main.group()
def dataset() -> None:
    """Dataset management (register, browse, delete)."""


def _datasets_dir():
    from clinical_deid.config import get_settings

    return get_settings().datasets_dir


@dataset.command(name="list")
@click.option("--limit", type=int, default=50, show_default=True)
def dataset_list(limit: int) -> None:
    """List registered datasets."""
    from clinical_deid.dataset_store import list_datasets

    datasets = list_datasets(_datasets_dir())[:limit]
    if not datasets:
        click.echo("No datasets registered.")
        return

    header = f"{'Name':<25} {'Format':<12} {'Docs':>6} {'Spans':>8} {'Labels'}"
    click.echo(header)
    click.echo("-" * len(header))
    for ds in datasets:
        labels_str = ", ".join(ds.labels[:5])
        if len(ds.labels) > 5:
            labels_str += f" (+{len(ds.labels) - 5})"
        click.echo(
            f"{ds.name:<25} {ds.format:<12} {ds.document_count:>6} "
            f"{ds.total_spans:>8} {labels_str}"
        )


@dataset.command(name="register")
@click.argument("data_path", type=click.Path(exists=True))
@click.option("--name", required=True, help="Dataset name.")
@click.option(
    "--format",
    "fmt",
    type=click.Choice(["jsonl", "brat-dir", "brat-corpus"]),
    default="jsonl",
    show_default=True,
)
@click.option("--description", default="", help="Optional description.")
def dataset_register(data_path: str, name: str, fmt: str, description: str) -> None:
    """Register a dataset from a local path.

    \b
    Examples:
      clinical-deid dataset register data/corpus.jsonl --name i2b2-2014
      clinical-deid dataset register data/brat/ --name physionet --format brat-dir
    """
    from clinical_deid.dataset_store import register_dataset

    try:
        manifest = register_dataset(
            _datasets_dir(),
            name,
            str(Path(data_path).resolve()),
            fmt,
            description=description,
        )
    except (ValueError, FileNotFoundError) as exc:
        click.echo(f"Error: {exc}", err=True)
        raise SystemExit(1)

    click.echo(
        f"Registered {name!r}: {manifest['document_count']} docs, "
        f"{manifest['total_spans']} spans, "
        f"labels: {', '.join(manifest['labels'])}"
    )


@dataset.command(name="show")
@click.argument("name")
def dataset_show(name: str) -> None:
    """Show details of a registered dataset."""
    from clinical_deid.dataset_store import load_dataset_manifest

    try:
        m = load_dataset_manifest(_datasets_dir(), name)
    except FileNotFoundError as exc:
        click.echo(f"Error: {exc}", err=True)
        raise SystemExit(1)

    click.echo(f"Name:          {m['name']}")
    click.echo(f"Description:   {m.get('description', '')}")
    click.echo(f"Data path:     {m['data_path']}")
    click.echo(f"Format:        {m['format']}")
    click.echo(f"Documents:     {m.get('document_count', 0)}")
    click.echo(f"Total spans:   {m.get('total_spans', 0)}")
    click.echo(f"Labels:        {', '.join(m.get('labels', []))}")
    click.echo(f"Created:       {m.get('created_at', '')}")
    if m.get("metadata"):
        click.echo(f"Metadata:      {json.dumps(m['metadata'], indent=2)}")
    analytics = m.get("analytics", {})
    if analytics:
        label_counts = analytics.get("label_counts", {})
        if label_counts:
            click.echo("\nLabel distribution:")
            for label, count in sorted(label_counts.items(), key=lambda x: -x[1]):
                click.echo(f"  {label:<20} {count:>6}")


@dataset.command(name="delete")
@click.argument("name")
def dataset_delete(name: str) -> None:
    """Unregister a dataset (does not delete underlying data files)."""
    from clinical_deid.dataset_store import delete_dataset

    try:
        delete_dataset(_datasets_dir(), name)
    except FileNotFoundError as exc:
        click.echo(f"Error: {exc}", err=True)
        raise SystemExit(1)
    click.echo(f"Deleted dataset {name!r}")


# ---------------------------------------------------------------------------
# train
# ---------------------------------------------------------------------------


@main.group()
def train() -> None:
    """Fine-tune HF encoder models for PHI NER (requires pip install '.[train]')."""


def _models_dir():
    from clinical_deid.config import get_settings

    return get_settings().models_dir


@train.command(name="run")
@click.option("--base", "base_model", required=False, default=None, help="HF Hub id or 'local:<name>'.")
@click.option("--train-dataset", required=False, default=None, help="Registered dataset name.")
@click.option("--extra-train-dataset", "extra_train_datasets", multiple=True,
              help="Additional dataset(s) to merge into training (repeatable).")
@click.option("--output", "output_name", required=False, default=None, help="Output model name.")
@click.option("--eval-dataset", default=None, help="Separate eval dataset name.")
@click.option("--eval-fraction", type=float, default=None, help="Fraction of train set to use for eval.")
@click.option("--eval-test-dataset", "test_dataset", default=None, help="Held-out test dataset evaluated once after training.")
@click.option("--epochs", type=float, default=None)
@click.option("--lr", "learning_rate", type=float, default=None)
@click.option("--batch-size", "per_device_train_batch_size", type=int, default=None)
@click.option("--max-length", type=int, default=None)
@click.option("--freeze-encoder", is_flag=True, default=False)
@click.option("--segmentation", type=click.Choice(["truncate", "sentence"]), default=None,
              help="How to split docs for training. 'truncate' (default) crops long "
                   "docs at max-length; 'sentence' splits into sentences and trains "
                   "one example per sentence.")
@click.option("--device", default=None, help="cpu | cuda | cuda:N | mps")
@click.option("--overwrite", is_flag=True, default=False)
@click.option("--config", "config_path", type=click.Path(exists=True), default=None,
              help="JSON config file. Mutually exclusive with all other flags.")
def train_run(
    base_model: str | None,
    train_dataset: str | None,
    extra_train_datasets: tuple[str, ...],
    output_name: str | None,
    eval_dataset: str | None,
    eval_fraction: float | None,
    test_dataset: str | None,
    epochs: float | None,
    learning_rate: float | None,
    per_device_train_batch_size: int | None,
    max_length: int | None,
    freeze_encoder: bool,
    segmentation: str | None,
    device: str | None,
    overwrite: bool,
    config_path: str | None,
) -> None:
    """Fine-tune an HF encoder model for PHI NER.

    \b
    Examples:
      clinical-deid train run \\
        --base emilyalsentzer/Bio_ClinicalBERT \\
        --train-dataset i2b2-2014 --eval-fraction 0.1 \\
        --output clinical-bert-v1 --epochs 3

      clinical-deid train run \\
        --base local:clinical-bert-v1 \\
        --train-dataset internal-2026 \\
        --output clinical-bert-v2 --freeze-encoder

      clinical-deid train run --config training/my_run.json
    """
    import json

    from clinical_deid.training.config import TrainingConfig, TrainingHyperparams
    from clinical_deid.training.errors import TrainingError
    from clinical_deid.training.runner import run_training

    if config_path is not None:
        if any([eval_dataset, eval_fraction, test_dataset, epochs, learning_rate,
                per_device_train_batch_size, max_length, freeze_encoder, segmentation,
                device, overwrite, extra_train_datasets]):
            click.echo("Error: --config cannot be combined with other flags.", err=True)
            raise SystemExit(1)
        raw = json.loads(Path(config_path).read_text(encoding="utf-8"))
        try:
            cfg = TrainingConfig(**raw)
        except Exception as exc:
            click.echo(f"Error in config file: {exc}", err=True)
            raise SystemExit(1)
    else:
        if not base_model or not train_dataset or not output_name:
            click.echo(
                "Error: --base, --train-dataset, and --output are required when not using --config.",
                err=True,
            )
            raise SystemExit(1)

        hp_overrides: dict = {}
        if epochs is not None:
            hp_overrides["epochs"] = epochs
        if learning_rate is not None:
            hp_overrides["learning_rate"] = learning_rate
        if per_device_train_batch_size is not None:
            hp_overrides["per_device_train_batch_size"] = per_device_train_batch_size
        if max_length is not None:
            hp_overrides["max_length"] = max_length

        try:
            cfg_kwargs: dict = dict(
                base_model=base_model,
                train_dataset=train_dataset,
                extra_train_datasets=list(extra_train_datasets),
                output_name=output_name,
                eval_dataset=eval_dataset,
                eval_fraction=eval_fraction,
                test_dataset=test_dataset,
                freeze_encoder=freeze_encoder,
                device=device,
                overwrite=overwrite,
                hyperparams=TrainingHyperparams(**hp_overrides) if hp_overrides else TrainingHyperparams(),
            )
            if segmentation is not None:
                cfg_kwargs["segmentation"] = segmentation
            cfg = TrainingConfig(**cfg_kwargs)
        except Exception as exc:
            click.echo(f"Error: {exc}", err=True)
            raise SystemExit(1)

    try:
        final_path = run_training(
            cfg,
            models_dir=_models_dir(),
            datasets_dir=_datasets_dir(),
        )
        click.echo(f"Training complete: {final_path}")
    except TrainingError as exc:
        click.echo(f"Error: {exc}", err=True)
        raise SystemExit(1)
    except ImportError as exc:
        click.echo(f"Error: {exc}", err=True)
        raise SystemExit(1)


@train.command(name="show")
@click.argument("name")
def train_show(name: str) -> None:
    """Show manifest, metrics, and training lineage for a model."""
    from clinical_deid.models import get_model

    try:
        info = get_model(_models_dir(), name)
    except KeyError as exc:
        click.echo(f"Error: {exc}", err=True)
        raise SystemExit(1)

    click.echo(f"Name:           {info.name}")
    click.echo(f"Framework:      {info.framework}")
    click.echo(f"Schema version: {info.schema_version or 1}")
    click.echo(f"Labels:         {', '.join(info.labels)}")
    click.echo(f"Base model:     {info.base_model or '—'}")
    click.echo(f"Parent model:   {info.parent_model or '—'}")
    click.echo(f"Has CRF:        {info.has_crf}")

    training = info.training_meta
    if training:
        click.echo(f"\nTraining:")
        click.echo(f"  Dataset:      {training.get('train_dataset', '—')}")
        click.echo(f"  Documents:    {training.get('train_documents', '—')}")
        click.echo(f"  Device:       {training.get('device_used', '—')}")
        click.echo(f"  Steps:        {training.get('total_steps', '—')}")
        click.echo(f"  Runtime:      {training.get('train_runtime_sec', '—')}s")
        click.echo(f"  Trained at:   {training.get('trained_at', '—')}")
        if training.get("head_reinitialised"):
            click.echo("  ⚠  Head was reinitialised (label space changed from parent)")

    metrics = info.metrics
    if metrics and metrics.get("overall"):
        o = metrics["overall"]
        click.echo(
            f"\nMetrics (overall):  "
            f"P={o.get('precision', 0):.4f}  "
            f"R={o.get('recall', 0):.4f}  "
            f"F1={o.get('f1', 0):.4f}"
        )
        per_label = metrics.get("per_label", {})
        if per_label:
            click.echo(f"\n{'Label':<22} {'P':>8} {'R':>8} {'F1':>8} {'Support':>8}")
            click.echo("-" * 56)
            for label, lm in sorted(per_label.items()):
                click.echo(
                    f"{label:<22} {lm.get('precision', 0):>8.4f} "
                    f"{lm.get('recall', 0):>8.4f} {lm.get('f1', 0):>8.4f} "
                    f"{lm.get('support', 0):>8}"
                )
    else:
        click.echo("\nNo metrics recorded (trained without eval split).")


@dataset.command(name="export")
@click.argument("name")
@click.option("-o", "--output", "output_dir", type=click.Path(), required=True)
@click.option(
    "--format",
    "fmt",
    type=click.Choice(["conll", "spacy", "huggingface"]),
    default="conll",
    show_default=True,
    help="Training data format.",
)
@click.option("--filename", default=None, help="Override output filename.")
def dataset_export(name: str, output_dir: str, fmt: str, filename: str | None) -> None:
    """Export a registered dataset to a training format.

    \b
    Examples:
      clinical-deid dataset export i2b2-2014 -o training/ --format conll
      clinical-deid dataset export physionet -o training/ --format spacy
      clinical-deid dataset export i2b2-2014 -o training/ --format huggingface
    """
    from clinical_deid.dataset_store import load_dataset_documents
    from clinical_deid.training_export import export_training_data

    try:
        docs = load_dataset_documents(_datasets_dir(), name)
    except FileNotFoundError as exc:
        click.echo(f"Error: {exc}", err=True)
        raise SystemExit(1)

    if not docs:
        click.echo("Dataset has no documents.", err=True)
        raise SystemExit(1)

    try:
        path = export_training_data(
            docs, Path(output_dir), fmt, filename=filename
        )
    except ImportError as exc:
        click.echo(f"Error: {exc}", err=True)
        raise SystemExit(1)

    total_spans = sum(len(d.spans) for d in docs)
    click.echo(
        f"Exported {len(docs)} docs ({total_spans} spans) to {path}"
    )
