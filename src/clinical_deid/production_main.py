"""Entry point for the production inference server.

Usage::

    # Via entry point (after pip install):
    clinical-deid-production

    # Or directly:
    python -m clinical_deid.production_main

    # With custom modes file:
    CLINICAL_DEID_MODES_PATH=modes.json clinical-deid-production

    # With custom host/port:
    clinical-deid-production --host 0.0.0.0 --port 9000
"""

from __future__ import annotations

import argparse
import logging
import os


def main() -> None:
    parser = argparse.ArgumentParser(description="Clinical De-Identification production API server")
    parser.add_argument("--host", default="0.0.0.0", help="Bind host (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="Bind port (default: 8000)")
    parser.add_argument("--modes", default=None, help="Path to modes.json (default: modes.json in cwd)")
    parser.add_argument("--workers", type=int, default=1, help="Number of uvicorn workers")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Pass modes path via env var so the app factory can pick it up on import
    if args.modes:
        os.environ["CLINICAL_DEID_MODES_PATH"] = args.modes

    import uvicorn

    uvicorn.run(
        "clinical_deid.production_main:app",
        host=args.host,
        port=args.port,
        workers=args.workers,
    )


def _create_app():
    """Module-level app for uvicorn import."""
    modes_path = os.environ.get("CLINICAL_DEID_MODES_PATH")
    from clinical_deid.api.production import create_production_app

    return create_production_app(modes_path=modes_path)


app = _create_app()

if __name__ == "__main__":
    main()
