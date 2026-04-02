"""Per-label surrogate replacement strategies backed by Faker."""

from __future__ import annotations

import random

from faker import Faker


class SurrogateGenerator:
    """Generate consistent fake replacements within a document scope.

    Same ``(label, original_text)`` pair always produces the same surrogate
    for the lifetime of this generator (or until :meth:`reset` is called).
    """

    def __init__(self, seed: int | None = None, *, consistency: bool = True) -> None:
        self._faker = Faker()
        if seed is not None:
            Faker.seed(seed)
            random.seed(seed)
        self._consistency = consistency
        self._map: dict[tuple[str, str], str] = {}

    def replace(self, label: str, original_text: str) -> str:
        """Return a surrogate for *label* and *original_text*."""
        if self._consistency:
            key = (label.upper(), original_text)
            cached = self._map.get(key)
            if cached is not None:
                return cached
            result = self._generate(label, original_text)
            self._map[key] = result
            return result
        return self._generate(label, original_text)

    def reset(self) -> None:
        """Clear the consistency map (call between documents)."""
        self._map.clear()

    # ------------------------------------------------------------------
    # Label dispatch
    # ------------------------------------------------------------------

    def _generate(self, label: str, original_text: str) -> str:
        up = label.upper()
        if up in ("NAME", "PATIENT", "PERSON", "STAFF", "HCW", "DOCTOR"):
            return self._gen_name(original_text)
        if up in ("DATE", "DATE_TIME"):
            return self._gen_date(original_text)
        if up in ("PHONE", "PHONE_NUMBER", "FAX"):
            return self._faker.phone_number()
        if up in ("EMAIL", "EMAIL_ADDRESS"):
            return self._faker.email()
        if up in ("ID", "MRN", "SSN", "SIN", "OHIP", "IDNUM"):
            return self._gen_id(original_text)
        if up in ("LOCATION", "ADDRESS", "LOCATION_OTHER"):
            return self._faker.street_address()
        if up in ("POSTAL_CODE_CA",):
            return self._faker.postalcode()
        if up in ("HOSPITAL", "ORGANIZATION"):
            return self._faker.company()
        if up in ("AGE",):
            return str(random.randint(20, 89))
        if up in ("COUNTRY",):
            return self._faker.country()
        if up in ("STATE",):
            return self._faker.state()
        if up in ("URL",):
            return self._faker.url()
        # Fallback: same-length asterisks
        return "*" * len(original_text)

    def _gen_name(self, original: str) -> str:
        parts = original.split()
        if len(parts) >= 2:
            return f"{self._faker.first_name()} {self._faker.last_name()}"
        if original and original[0].isupper():
            return self._faker.first_name()
        return self._faker.last_name()

    def _gen_date(self, original: str) -> str:
        fake_date = self._faker.date_between(start_date="-10y", end_date="today")
        if "/" in original:
            return fake_date.strftime("%m/%d/%Y")
        if "-" in original:
            return fake_date.strftime("%Y-%m-%d")
        return fake_date.strftime("%b %d, %Y")

    def _gen_id(self, original: str) -> str:
        n = max(len(original), 4)
        return str(self._faker.random_number(digits=n)).zfill(n)
