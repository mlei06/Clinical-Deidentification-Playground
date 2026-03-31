"""Detector pipe wrapping the pyDeid library for clinical PHI detection."""

from clinical_deid.pipes.pydeid_ner.pipe import PyDeidNerConfig, PyDeidNerPipe

__all__ = ["PyDeidNerConfig", "PyDeidNerPipe"]
