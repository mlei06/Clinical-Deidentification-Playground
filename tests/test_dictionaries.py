"""Tests for dictionary store, API endpoints, and pipe integration."""

from __future__ import annotations

import io

import pytest

from clinical_deid.dictionary_store import DictionaryStore
from clinical_deid.domain import AnnotatedDocument, Document, EntitySpan


def _doc(text: str) -> AnnotatedDocument:
    return AnnotatedDocument(document=Document(id="d", text=text), spans=[])


# ---------------------------------------------------------------------------
# DictionaryStore unit tests
# ---------------------------------------------------------------------------


class TestDictionaryStore:
    def test_save_and_list_whitelist(self, tmp_path):
        store = DictionaryStore(tmp_path)
        info = store.save("whitelist", "my_hospitals", "Hospital A\nHospital B\n", label="HOSPITAL")
        assert info.kind == "whitelist"
        assert info.label == "HOSPITAL"
        assert info.name == "my_hospitals"
        assert info.term_count == 2

        listed = store.list_dictionaries(kind="whitelist")
        assert len(listed) == 1
        assert listed[0].name == "my_hospitals"

    def test_save_and_list_blacklist(self, tmp_path):
        store = DictionaryStore(tmp_path)
        info = store.save("blacklist", "safe_words", "NORMAL\nSTABLE\n")
        assert info.kind == "blacklist"
        assert info.label is None
        assert info.term_count == 2

        listed = store.list_dictionaries(kind="blacklist")
        assert len(listed) == 1

    def test_get_terms(self, tmp_path):
        store = DictionaryStore(tmp_path)
        store.save("whitelist", "docs", "Dr. Smith\nDr. Jones\n", label="DOCTOR")
        terms = store.get_terms("whitelist", "docs", label="DOCTOR")
        assert terms == ["Dr. Smith", "Dr. Jones"]

    def test_get_terms_not_found(self, tmp_path):
        store = DictionaryStore(tmp_path)
        with pytest.raises(FileNotFoundError):
            store.get_terms("whitelist", "nonexistent", label="HOSPITAL")

    def test_delete(self, tmp_path):
        store = DictionaryStore(tmp_path)
        store.save("blacklist", "temp", "word1\nword2\n")
        store.delete("blacklist", "temp")
        assert store.list_dictionaries(kind="blacklist") == []

    def test_delete_not_found(self, tmp_path):
        store = DictionaryStore(tmp_path)
        with pytest.raises(FileNotFoundError):
            store.delete("blacklist", "nonexistent")

    def test_save_overwrites_existing(self, tmp_path):
        store = DictionaryStore(tmp_path)
        store.save("blacklist", "words", "old\n")
        store.save("blacklist", "words", "new1\nnew2\n")
        terms = store.get_terms("blacklist", "words")
        assert terms == ["new1", "new2"]

    def test_list_filters_by_label(self, tmp_path):
        store = DictionaryStore(tmp_path)
        store.save("whitelist", "list_a", "A\n", label="HOSPITAL")
        store.save("whitelist", "list_b", "B\n", label="DOCTOR")
        hospital_dicts = store.list_dictionaries(kind="whitelist", label="HOSPITAL")
        assert len(hospital_dicts) == 1
        assert hospital_dicts[0].label == "HOSPITAL"

    def test_load_whitelist_terms_bulk(self, tmp_path):
        store = DictionaryStore(tmp_path)
        store.save("whitelist", "list1", "Alpha\nBeta\n", label="HOSPITAL")
        store.save("whitelist", "list2", "Gamma\n", label="HOSPITAL")
        terms = store.load_whitelist_terms(["list1", "list2"], "HOSPITAL")
        assert terms == ["Alpha", "Beta", "Gamma"]

    def test_load_blacklist_terms_bulk(self, tmp_path):
        store = DictionaryStore(tmp_path)
        store.save("blacklist", "safe1", "NORMAL\n")
        store.save("blacklist", "safe2", "STABLE\n")
        terms = store.load_blacklist_terms(["safe1", "safe2"])
        assert terms == ["NORMAL", "STABLE"]

    def test_whitelist_requires_label(self, tmp_path):
        store = DictionaryStore(tmp_path)
        with pytest.raises(ValueError, match="require a label"):
            store.save("whitelist", "no_label", "term\n")

    def test_csv_dictionary(self, tmp_path):
        store = DictionaryStore(tmp_path)
        store.save("whitelist", "hospitals_csv", "term\nHospital A\nHospital B\n", label="HOSPITAL", extension=".csv")
        terms = store.get_terms("whitelist", "hospitals_csv", label="HOSPITAL")
        assert terms == ["Hospital A", "Hospital B"]

    def test_get_preview(self, tmp_path):
        store = DictionaryStore(tmp_path)
        store.save("blacklist", "words", "alpha\nbeta\ngamma\ndelta\n")
        preview = store.get_preview("blacklist", "words")
        assert preview["kind"] == "blacklist"
        assert preview["name"] == "words"
        assert preview["term_count"] == 4
        assert preview["sample_terms"] == ["alpha", "beta", "gamma", "delta"]
        assert preview["file_size_bytes"] > 0

    def test_get_preview_sample_limit(self, tmp_path):
        store = DictionaryStore(tmp_path)
        terms = "\n".join(f"term_{i}" for i in range(50))
        store.save("blacklist", "big", terms)
        preview = store.get_preview("blacklist", "big", sample_size=5)
        assert len(preview["sample_terms"]) == 5

    def test_get_preview_not_found(self, tmp_path):
        store = DictionaryStore(tmp_path)
        with pytest.raises(FileNotFoundError):
            store.get_preview("blacklist", "missing")

    def test_get_terms_paginated(self, tmp_path):
        store = DictionaryStore(tmp_path)
        store.save("blacklist", "paged", "a\nb\nc\nd\ne\n")
        page = store.get_terms_paginated("blacklist", "paged", offset=1, limit=2)
        assert page["terms"] == ["b", "c"]
        assert page["total"] == 5
        assert page["offset"] == 1
        assert page["limit"] == 2

    def test_get_terms_paginated_search(self, tmp_path):
        store = DictionaryStore(tmp_path)
        store.save("blacklist", "searchable", "apple\nbanana\napricot\ncherry\n")
        page = store.get_terms_paginated("blacklist", "searchable", search="ap")
        assert page["terms"] == ["apple", "apricot"]
        assert page["total"] == 2

    def test_get_terms_paginated_not_found(self, tmp_path):
        store = DictionaryStore(tmp_path)
        with pytest.raises(FileNotFoundError):
            store.get_terms_paginated("blacklist", "missing")


# ---------------------------------------------------------------------------
# API endpoint tests
# ---------------------------------------------------------------------------


def test_upload_whitelist_dictionary(client):
    content = b"Toronto General Hospital\nSunnybrook\n"
    r = client.post(
        "/dictionaries",
        files=[("file", ("hospitals.txt", io.BytesIO(content), "text/plain"))],
        data={"kind": "whitelist", "name": "test_hospitals", "label": "HOSPITAL"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["info"]["kind"] == "whitelist"
    assert body["info"]["label"] == "HOSPITAL"
    assert body["info"]["name"] == "test_hospitals"
    assert body["info"]["term_count"] == 2


def test_upload_blacklist_dictionary(client):
    content = b"NORMAL\nSTABLE\nUNCHANGED\n"
    r = client.post(
        "/dictionaries",
        files=[("file", ("safe.txt", io.BytesIO(content), "text/plain"))],
        data={"kind": "blacklist", "name": "safe_terms"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["info"]["term_count"] == 3


def test_list_dictionaries(client):
    # Upload one first
    client.post(
        "/dictionaries",
        files=[("file", ("test.txt", io.BytesIO(b"term1\n"), "text/plain"))],
        data={"kind": "blacklist", "name": "listed"},
    )
    r = client.get("/dictionaries")
    assert r.status_code == 200
    items = r.json()
    assert any(d["name"] == "listed" for d in items)


def test_list_dictionaries_filter_by_kind(client):
    client.post(
        "/dictionaries",
        files=[("file", ("test.txt", io.BytesIO(b"term1\n"), "text/plain"))],
        data={"kind": "blacklist", "name": "bl_only"},
    )
    r = client.get("/dictionaries?kind=whitelist")
    assert r.status_code == 200
    assert not any(d["name"] == "bl_only" for d in r.json())


def test_get_dictionary_terms(client):
    client.post(
        "/dictionaries",
        files=[("file", ("test.txt", io.BytesIO(b"Alpha\nBeta\n"), "text/plain"))],
        data={"kind": "blacklist", "name": "get_test"},
    )
    r = client.get("/dictionaries/blacklist/get_test")
    assert r.status_code == 200
    body = r.json()
    assert body["terms"] == ["Alpha", "Beta"]
    assert body["term_count"] == 2


def test_get_dictionary_not_found(client):
    r = client.get("/dictionaries/blacklist/nonexistent")
    assert r.status_code == 404


def test_delete_dictionary(client):
    client.post(
        "/dictionaries",
        files=[("file", ("test.txt", io.BytesIO(b"term\n"), "text/plain"))],
        data={"kind": "blacklist", "name": "to_delete"},
    )
    r = client.delete("/dictionaries/blacklist/to_delete")
    assert r.status_code == 204
    r2 = client.get("/dictionaries/blacklist/to_delete")
    assert r2.status_code == 404


def test_delete_dictionary_not_found(client):
    r = client.delete("/dictionaries/blacklist/nonexistent")
    assert r.status_code == 404


def test_get_dictionary_preview(client):
    client.post(
        "/dictionaries",
        files=[("file", ("test.txt", io.BytesIO(b"Alpha\nBeta\nGamma\n"), "text/plain"))],
        data={"kind": "blacklist", "name": "preview_test"},
    )
    r = client.get("/dictionaries/blacklist/preview_test/preview")
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "preview_test"
    assert body["term_count"] == 3
    assert body["sample_terms"] == ["Alpha", "Beta", "Gamma"]
    assert body["file_size_bytes"] > 0


def test_get_dictionary_preview_not_found(client):
    r = client.get("/dictionaries/blacklist/nonexistent/preview")
    assert r.status_code == 404


def test_get_dictionary_terms_paginated(client):
    terms = "\n".join(f"term_{i}" for i in range(20))
    client.post(
        "/dictionaries",
        files=[("file", ("test.txt", io.BytesIO(terms.encode()), "text/plain"))],
        data={"kind": "blacklist", "name": "paged_test"},
    )
    r = client.get("/dictionaries/blacklist/paged_test/terms?offset=5&limit=3")
    assert r.status_code == 200
    body = r.json()
    assert len(body["terms"]) == 3
    assert body["total"] == 20
    assert body["offset"] == 5
    assert body["limit"] == 3


def test_get_dictionary_terms_paginated_search(client):
    client.post(
        "/dictionaries",
        files=[("file", ("test.txt", io.BytesIO(b"apple\nbanana\napricot\ncherry\n"), "text/plain"))],
        data={"kind": "blacklist", "name": "search_test"},
    )
    r = client.get("/dictionaries/blacklist/search_test/terms?search=ap")
    assert r.status_code == 200
    body = r.json()
    assert body["terms"] == ["apple", "apricot"]
    assert body["total"] == 2


def test_get_dictionary_terms_paginated_not_found(client):
    r = client.get("/dictionaries/blacklist/nonexistent/terms")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Pipe integration tests
# ---------------------------------------------------------------------------


def test_whitelist_pipe_with_dictionary(tmp_path, monkeypatch):
    """Whitelist pipe loads terms from a dictionary in the store."""
    monkeypatch.setenv("CLINICAL_DEID_DICTIONARIES_DIR", str(tmp_path))
    from clinical_deid.config import reset_settings
    reset_settings()

    store = DictionaryStore(tmp_path)
    store.save("whitelist", "test_hospitals", "Alpha Clinic\n", label="HOSPITAL")

    from clinical_deid.pipes.whitelist import WhitelistConfig, WhitelistLabelConfig, WhitelistPipe

    config = WhitelistConfig(
        load_all_dictionaries=False,
        per_label={
            "HOSPITAL": WhitelistLabelConfig(
                dictionaries=["test_hospitals"],
            ),
        },
    )
    pipe = WhitelistPipe(config)
    result = pipe.forward(_doc("Admitted to Alpha Clinic today."))
    assert any(s.label == "HOSPITAL" for s in result.spans)

    reset_settings()


def test_blacklist_pipe_with_dictionary(tmp_path, monkeypatch):
    """Blacklist pipe loads terms from a dictionary in the store."""
    monkeypatch.setenv("CLINICAL_DEID_DICTIONARIES_DIR", str(tmp_path))
    from clinical_deid.config import reset_settings
    reset_settings()

    store = DictionaryStore(tmp_path)
    store.save("blacklist", "safe_words", "PATIENT\n")

    from clinical_deid.pipes.blacklist import BlacklistSpans, BlacklistSpansConfig

    text = "seen in PATIENT room"
    spans = [EntitySpan(start=text.index("PATIENT"), end=text.index("PATIENT") + 7, label="NAME")]
    doc = AnnotatedDocument(document=Document(id="d", text=text), spans=spans)

    config = BlacklistSpansConfig(
        load_all_dictionaries=False,
        dictionaries=["safe_words"],
    )
    pipe = BlacklistSpans(config)
    result = pipe.forward(doc)
    assert not any(s.label == "NAME" for s in result.spans)

    reset_settings()
