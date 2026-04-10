"""Compatibility re-export — implementations live in :mod:`clinical_deid.pipes.word_lists.lists`."""

from clinical_deid.pipes.word_lists.lists import (
    load_terms_from_path,
    parse_list_csv,
    parse_list_file,
    parse_list_json,
    parse_list_text,
    term_to_list_pattern,
)

__all__ = [
    "load_terms_from_path",
    "parse_list_csv",
    "parse_list_file",
    "parse_list_json",
    "parse_list_text",
    "term_to_list_pattern",
]
