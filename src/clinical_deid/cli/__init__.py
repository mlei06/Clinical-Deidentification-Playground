"""CLI package — the ``main`` group and its subcommands live in sibling modules.

The ``clinical-deid`` console-script entry point in ``pyproject.toml`` still
resolves to ``clinical_deid.cli:main`` via this re-export.
"""

from __future__ import annotations

from clinical_deid.cli.root import main

# Importing each sub-module registers its commands/subgroups on ``main``.
from clinical_deid.cli import audit  # noqa: E402, F401
from clinical_deid.cli import dataset  # noqa: E402, F401
from clinical_deid.cli import dict_  # noqa: E402, F401
from clinical_deid.cli import train  # noqa: E402, F401

__all__ = ["main"]
