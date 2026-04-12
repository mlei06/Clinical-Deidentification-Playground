"""Tests for redaction evaluation metrics."""

from __future__ import annotations

from clinical_deid.eval.redaction import compute_redaction_metrics


def test_perfect_redaction():
    """All PHI successfully removed."""
    original = "Patient John Smith was seen on 01/15/1990."
    redacted = "Patient [PATIENT] was seen on [DATE]."
    gold = [
        {"start": 8, "end": 18, "label": "PATIENT"},
        {"start": 31, "end": 41, "label": "DATE"},
    ]
    m = compute_redaction_metrics(original, redacted, gold)
    assert m.gold_phi_count == 2
    assert m.leaked_phi_count == 0
    assert m.leakage_rate == 0.0
    assert m.redaction_recall == 1.0
    assert len(m.per_label) == 2
    assert all(ll.leaked_count == 0 for ll in m.per_label)


def test_full_leakage():
    """PHI not redacted at all (identity transform)."""
    original = "Patient John Smith was seen on 01/15/1990."
    redacted = original  # nothing changed
    gold = [
        {"start": 8, "end": 18, "label": "PATIENT"},
        {"start": 31, "end": 41, "label": "DATE"},
    ]
    m = compute_redaction_metrics(original, redacted, gold)
    assert m.gold_phi_count == 2
    assert m.leaked_phi_count == 2
    assert m.leakage_rate == 1.0
    assert m.redaction_recall == 0.0


def test_partial_leakage():
    """One PHI redacted, one leaked."""
    original = "Patient John Smith SSN 123-45-6789."
    #           01234567890123456789012345678901234
    redacted = "Patient [PATIENT] SSN 123-45-6789."
    gold = [
        {"start": 8, "end": 18, "label": "PATIENT"},
        {"start": 23, "end": 34, "label": "SSN"},
    ]
    m = compute_redaction_metrics(original, redacted, gold)
    assert m.gold_phi_count == 2
    assert m.leaked_phi_count == 1
    assert m.leakage_rate == 0.5
    assert m.redaction_recall == 0.5

    # Check per-label
    label_map = {ll.label: ll for ll in m.per_label}
    assert label_map["PATIENT"].leaked_count == 0
    assert label_map["SSN"].leaked_count == 1

    # Check leaked spans detail
    assert len(m.leaked_spans) == 1
    assert m.leaked_spans[0].label == "SSN"
    assert m.leaked_spans[0].original_text == "123-45-6789"


def test_surrogate_replacement():
    """PHI replaced with surrogate (different text)."""
    original = "Patient John Smith called at 555-123-4567."
    redacted = "Patient Jane Doe called at 555-987-6543."
    gold = [
        {"start": 8, "end": 18, "label": "PATIENT"},
        {"start": 29, "end": 41, "label": "PHONE"},
    ]
    m = compute_redaction_metrics(original, redacted, gold)
    assert m.gold_phi_count == 2
    assert m.leaked_phi_count == 0
    assert m.redaction_recall == 1.0


def test_case_insensitive_leakage():
    """PHI leaks even with case changes."""
    original = "Doctor JANE DOE prescribed."
    redacted = "Doctor jane doe prescribed."  # lowercased but still present
    gold = [
        {"start": 7, "end": 15, "label": "DOCTOR"},
    ]
    m = compute_redaction_metrics(original, redacted, gold)
    assert m.leaked_phi_count == 1


def test_no_gold_spans():
    """Document with no PHI should get perfect scores."""
    m = compute_redaction_metrics("No PHI here.", "No PHI here.", [])
    assert m.gold_phi_count == 0
    assert m.leaked_phi_count == 0
    assert m.redaction_recall == 1.0
    assert m.leakage_rate == 0.0


def test_empty_phi_text_ignored():
    """Spans covering whitespace-only text are ignored."""
    original = "Hello   world"
    redacted = "Hello [X] world"
    gold = [
        {"start": 5, "end": 8, "label": "FILLER"},  # just spaces
    ]
    m = compute_redaction_metrics(original, redacted, gold)
    assert m.gold_phi_count == 0  # whitespace-only spans are excluded
