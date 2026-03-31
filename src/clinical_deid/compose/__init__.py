from clinical_deid.compose.flatten import flatten_annotated_document, flatten_corpus
from clinical_deid.compose.load import load_one_source
from clinical_deid.compose.pipeline import compose_corpora
from clinical_deid.compose.strategies import (
    CompositionStrategy,
    compose_interleave,
    compose_merge,
    compose_proportional,
    run_composition_strategy,
)

__all__ = [
    "CompositionStrategy",
    "compose_corpora",
    "compose_interleave",
    "compose_merge",
    "compose_proportional",
    "flatten_annotated_document",
    "flatten_corpus",
    "load_one_source",
    "run_composition_strategy",
]
