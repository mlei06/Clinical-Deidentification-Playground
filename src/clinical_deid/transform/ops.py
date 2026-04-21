from __future__ import annotations

import random
from copy import deepcopy

from clinical_deid.domain import AnnotatedDocument, Document, PHISpan
from clinical_deid.pipes.detector_label_mapping import remap_span_labels
from clinical_deid.transform.splits import reassign_splits


def clone_annotated_document(ad: AnnotatedDocument, new_document_id: str) -> AnnotatedDocument:
    """Deep copy with a new logical document id (for duplicates)."""
    meta = dict(ad.document.metadata)
    doc = Document(id=new_document_id, text=ad.document.text, metadata=meta)
    spans = [
        PHISpan.model_validate(deepcopy(s.model_dump(mode="json", exclude_none=True)))
        for s in ad.spans
    ]
    return AnnotatedDocument(document=doc, spans=spans)


def filter_labels(
    docs: list[AnnotatedDocument],
    *,
    drop: list[str] | None = None,
    keep: list[str] | None = None,
) -> list[AnnotatedDocument]:
    """Remove or retain spans by label across all documents.

    Provide *drop* to remove specific labels, or *keep* to retain only those labels.
    """
    if drop and keep:
        raise ValueError("Provide either 'drop' or 'keep', not both")
    if not drop and not keep:
        return list(docs)

    out: list[AnnotatedDocument] = []
    for ad in docs:
        if drop:
            drop_set = set(drop)
            new_spans = [s for s in ad.spans if s.label not in drop_set]
        else:
            keep_set = set(keep)  # type: ignore[arg-type]
            new_spans = [s for s in ad.spans if s.label in keep_set]
        out.append(AnnotatedDocument(document=ad.document, spans=new_spans))
    return out


def apply_label_mapping(
    docs: list[AnnotatedDocument],
    mapping: dict[str, str],
) -> list[AnnotatedDocument]:
    """Replace span labels present in ``mapping``; others unchanged."""
    if not mapping:
        return list(docs)
    return [
        AnnotatedDocument(
            document=ad.document,
            spans=remap_span_labels(list(ad.spans), mapping),
        )
        for ad in docs
    ]


def random_resize(
    docs: list[AnnotatedDocument],
    target_n: int,
    *,
    seed: int = 42,
) -> list[AnnotatedDocument]:
    """
    Shrink or grow the corpus to exactly ``target_n`` documents by uniform random sampling.

    Downsampling is without replacement (stable relative order of picked docs).
    Upsampling draws random documents with replacement and assigns unique ids (``__rs{n}``).
    """
    if target_n < 0:
        raise ValueError("target_n must be non-negative")
    if target_n == 0:
        return []
    if not docs:
        return []
    rng = random.Random(seed)
    if target_n == len(docs):
        return list(docs)
    if target_n < len(docs):
        indices = sorted(rng.sample(range(len(docs)), target_n))
        return [docs[i] for i in indices]
    out: list[AnnotatedDocument] = list(docs)
    counter = 0
    while len(out) < target_n:
        counter += 1
        pick = docs[rng.randrange(len(docs))]
        out.append(
            clone_annotated_document(pick, f"{pick.document.id}__rs{counter}"),
        )
    return out


def boost_docs_with_label(
    docs: list[AnnotatedDocument],
    label: str,
    extra_copies: int,
    *,
    id_prefix: str = "b",
) -> list[AnnotatedDocument]:
    """
    For each document that contains at least one span with ``label``, append
    ``extra_copies`` duplicates with fresh document ids (``{id}__{prefix}{k}``).
    """
    if extra_copies <= 0:
        return list(docs)
    out: list[AnnotatedDocument] = list(docs)
    counter = 0
    for ad in docs:
        if not any(s.label == label for s in ad.spans):
            continue
        for _ in range(extra_copies):
            counter += 1
            out.append(
                clone_annotated_document(ad, f"{ad.document.id}__{id_prefix}{counter}"),
            )
    return out


def filter_documents_by_splits(
    docs: list[AnnotatedDocument],
    splits: list[str] | None,
) -> list[AnnotatedDocument]:
    """Keep only documents whose ``metadata['split']`` is in *splits*.

    When *splits* is empty or ``None``, returns *docs* unchanged. Documents
    without a string ``split`` key are excluded when filtering is active.
    """
    if not splits:
        return list(docs)
    allow = {s.strip() for s in splits if s and str(s).strip()}
    if not allow:
        return list(docs)
    out: list[AnnotatedDocument] = []
    for ad in docs:
        sp = ad.document.metadata.get("split")
        if isinstance(sp, str) and sp in allow:
            out.append(ad)
    return out


def strip_split_metadata(docs: list[AnnotatedDocument]) -> list[AnnotatedDocument]:
    """Remove ``metadata['split']`` from every document (flat corpus semantics)."""
    out: list[AnnotatedDocument] = []
    for ad in docs:
        meta = dict(ad.document.metadata)
        meta.pop("split", None)
        doc = ad.document.model_copy(update={"metadata": meta})
        out.append(AnnotatedDocument(document=doc, spans=list(ad.spans)))
    return out


def compute_transform_preview(
    docs: list[AnnotatedDocument],
    *,
    drop_labels: list[str] | None = None,
    keep_labels: list[str] | None = None,
    label_mapping: dict[str, str] | None = None,
    target_documents: int | None = None,
    boost_label: str | None = None,
    boost_extra_copies: int = 0,
    resplit: dict[str, float] | None = None,
    strip_splits: bool = False,
    seed: int = 42,
) -> dict[str, object]:
    """Dry-run summary for UI preview — mirrors :func:`run_transform_pipeline` ordering.

    Returns span counts for the filter + mapping stages, and document-level estimates
    for the full pipeline (resize, boost, resplit) by running the same functions on
    in-memory documents.
    """
    if drop_labels and keep_labels:
        raise ValueError("Provide either 'drop_labels' or 'keep_labels', not both")

    mapping = label_mapping or {}
    drop_set = set(drop_labels or [])
    map_keys = set(mapping.keys())

    conflicts: list[str] = []
    for k in sorted(map_keys & drop_set):
        conflicts.append(
            f"Label {k!r} appears in drop_labels and label_mapping; filtering removes "
            f"those spans before renaming, so the mapping has no effect.",
        )
    if keep_labels is not None:
        keep_set = set(keep_labels)
        for k in sorted(map_keys - keep_set):
            conflicts.append(
                f"Label {k!r} is remapped but not listed in keep_labels; "
                f"those spans are removed by the keep filter before mapping.",
            )

    total_spans_source = sum(len(ad.spans) for ad in docs)
    n_docs_source = len(docs)

    after_filter = filter_labels(docs, drop=drop_labels, keep=keep_labels)
    total_spans_after_filter = sum(len(ad.spans) for ad in after_filter)
    spans_dropped_by_filter = total_spans_source - total_spans_after_filter

    renamed = 0
    for ad in after_filter:
        for s in ad.spans:
            if s.label in mapping and mapping[s.label] != s.label:
                renamed += 1

    final = run_transform_pipeline(
        docs,
        drop_labels=drop_labels,
        keep_labels=keep_labels,
        label_mapping=label_mapping,
        target_documents=target_documents,
        boost_label=boost_label,
        boost_extra_copies=boost_extra_copies,
        resplit=resplit,
        strip_splits=strip_splits,
        seed=seed,
    )

    total_spans_final = sum(len(ad.spans) for ad in final)
    split_counts: dict[str, int] | None = None
    if resplit:
        sc: dict[str, int] = {}
        for ad in final:
            sp = ad.document.metadata.get("split")
            if isinstance(sp, str):
                sc[sp] = sc.get(sp, 0) + 1
        split_counts = sc if sc else None

    # Document counts after resize + boost (actual pipeline result length)
    projected_doc_count = len(final)

    return {
        "source_document_count": n_docs_source,
        "source_span_count": total_spans_source,
        "spans_dropped_by_filter": spans_dropped_by_filter,
        "spans_kept_after_filter": total_spans_after_filter,
        "spans_renamed": renamed,
        "projected_document_count": projected_doc_count,
        "projected_span_count": total_spans_final,
        "split_document_counts": split_counts,
        "conflicts": conflicts,
    }


def run_transform_pipeline(
    docs: list[AnnotatedDocument],
    *,
    drop_labels: list[str] | None = None,
    keep_labels: list[str] | None = None,
    label_mapping: dict[str, str] | None = None,
    target_documents: int | None = None,
    boost_label: str | None = None,
    boost_extra_copies: int = 0,
    resplit: dict[str, float] | None = None,
    strip_splits: bool = False,
    seed: int = 42,
) -> list[AnnotatedDocument]:
    """
    Ordered steps: (1) label filtering, (2) label mapping,
    (3) random resize to ``target_documents`` if set,
    (4) label boost, (5) ``reassign_splits`` if ``resplit`` is set,
    (6) ``strip_split_metadata`` if ``strip_splits`` (after resplit, so you can resplit then flatten keys).

    Use ``resplit`` to overwrite ``document.metadata[\"split\"]`` (e.g. train/valid/test/deploy).
    """
    cur = list(docs)
    if drop_labels or keep_labels:
        cur = filter_labels(cur, drop=drop_labels, keep=keep_labels)
    if label_mapping:
        cur = apply_label_mapping(cur, label_mapping)
    if target_documents is not None:
        cur = random_resize(cur, target_documents, seed=seed)
    if boost_label and boost_extra_copies > 0:
        cur = boost_docs_with_label(
            cur,
            boost_label,
            boost_extra_copies,
            id_prefix="boost",
        )
    if resplit:
        cur = reassign_splits(cur, resplit, seed=seed)
    if strip_splits:
        cur = strip_split_metadata(cur)
    return cur
