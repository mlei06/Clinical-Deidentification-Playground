from __future__ import annotations

import random
from copy import deepcopy

from clinical_deid.domain import AnnotatedDocument, Document, PHISpan
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
    out: list[AnnotatedDocument] = []
    for ad in docs:
        new_spans = [
            s.model_copy(update={"label": mapping.get(s.label, s.label)}) for s in ad.spans
        ]
        out.append(AnnotatedDocument(document=ad.document, spans=new_spans))
    return out


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


def strip_split_metadata(docs: list[AnnotatedDocument]) -> list[AnnotatedDocument]:
    """Remove ``metadata['split']`` from every document (flat corpus semantics)."""
    out: list[AnnotatedDocument] = []
    for ad in docs:
        meta = dict(ad.document.metadata)
        meta.pop("split", None)
        doc = ad.document.model_copy(update={"metadata": meta})
        out.append(AnnotatedDocument(document=doc, spans=list(ad.spans)))
    return out


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
