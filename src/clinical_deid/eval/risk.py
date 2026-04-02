"""Risk-weighted recall and HIPAA Safe Harbor coverage report."""

from __future__ import annotations

from clinical_deid.domain import PHISpan

# Default risk weights reflecting HIPAA sensitivity (higher = more critical to detect)
DEFAULT_RISK_WEIGHTS: dict[str, float] = {
    "SSN": 10.0,
    "MRN": 8.0,
    "PATIENT": 7.0,
    "PHONE": 6.0,
    "EMAIL": 6.0,
    "ID": 5.0,
    "DOCTOR": 4.0,
    "DATE": 3.0,
    "HOSPITAL": 2.0,
    "LOCATION": 2.0,
    "AGE": 1.0,
}

# Map platform labels to HIPAA Safe Harbor identifier numbers (1-18)
LABEL_TO_HIPAA: dict[str, list[int]] = {
    "PATIENT": [1],
    "DOCTOR": [1],
    "LOCATION": [2],
    "ADDRESS": [2],
    "ZIP": [2],
    "DATE": [3],
    "PHONE": [4],
    "FAX": [5],
    "EMAIL": [6],
    "SSN": [7],
    "MRN": [8],
    "ID": [8, 9, 10, 11, 18],
    "ACCOUNT": [10],
    "LICENSE": [11],
    "VEHICLE_ID": [12],
    "DEVICE_ID": [13],
    "URL": [14],
    "IP_ADDRESS": [15],
    "BIOMETRIC": [16],
}

HIPAA_IDENTIFIER_NAMES: dict[int, str] = {
    1: "Names",
    2: "Geographic data (smaller than state)",
    3: "Dates (except year)",
    4: "Phone numbers",
    5: "Fax numbers",
    6: "Email addresses",
    7: "Social Security numbers",
    8: "Medical record numbers",
    9: "Health plan beneficiary numbers",
    10: "Account numbers",
    11: "Certificate/license numbers",
    12: "Vehicle identifiers",
    13: "Device identifiers",
    14: "Web URLs",
    15: "IP addresses",
    16: "Biometric identifiers",
    17: "Full-face photographs",
    18: "Any other unique identifying number",
}


def risk_weighted_recall(
    false_negatives: list[PHISpan],
    gold_spans: list[PHISpan],
    weights: dict[str, float] | None = None,
) -> float:
    """Recall where each missed span is weighted by its label's risk.

    Returns a value in [0, 1] where 1.0 means no weighted misses.
    """
    w = weights or DEFAULT_RISK_WEIGHTS
    if not gold_spans:
        return 1.0

    total_weight = sum(w.get(s.label, 1.0) for s in gold_spans)
    missed_weight = sum(w.get(s.label, 1.0) for s in false_negatives)

    if total_weight == 0:
        return 1.0
    return max(0.0, 1.0 - missed_weight / total_weight)


def hipaa_coverage_report(
    pipeline_labels: set[str],
    label_to_hipaa: dict[str, list[int]] | None = None,
) -> dict[int, str]:
    """Return ``{hipaa_id: status}`` where status is ``covered``, ``partial``, or ``uncovered``.

    Identifier 17 (full-face photographs) is always ``n/a`` for text-only systems.
    """
    mapping = label_to_hipaa or LABEL_TO_HIPAA

    # Build reverse map: hipaa_id → set of labels that cover it
    hipaa_to_labels: dict[int, set[str]] = {}
    for label, ids in mapping.items():
        for hid in ids:
            hipaa_to_labels.setdefault(hid, set()).add(label)

    report: dict[int, str] = {}
    for hid in range(1, 19):
        if hid == 17:
            report[hid] = "n/a"
            continue
        covering_labels = hipaa_to_labels.get(hid, set())
        if not covering_labels:
            report[hid] = "uncovered"
        elif covering_labels & pipeline_labels:
            # At least one label covering this HIPAA ID is in the pipeline
            if covering_labels <= pipeline_labels:
                report[hid] = "covered"
            else:
                report[hid] = "partial"
        else:
            report[hid] = "uncovered"

    return report
