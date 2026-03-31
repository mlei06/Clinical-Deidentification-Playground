"""Map MIMIC placeholder descriptions to entity types and synthetic replacement strings."""

from __future__ import annotations

import logging
import random
import re
from datetime import timedelta

from clinical_deid.ingest.mimic.faker_providers import get_faker, getrandformat
from clinical_deid.ingest.mimic.names import generate_name

logger = logging.getLogger(__name__)

_monthlist = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
]


def get_placeholder_entity(placeholder: str) -> str:
    """Normalize bracket *content* (not including ``[`` … ``]``) to a coarse entity label."""
    p = placeholder.lower()
    fulldatepattern = r"\b\d{4}-\d{1,2}-\d{1,2}\b"
    monthdaypattern = r"\b\d{1,2}-\d{1,2}\b"
    monthyearpattern = r"\b\d{1,2}/\d{4}\b"
    monthyearpattern2 = r"-\d/\d{4}"
    monthyearpattern3 = r"\b\d{1}-/\d{4}\b"
    yearpattern = r"\b\d{4}\b"

    if "first" in p:
        return "first name"
    if "last" in p:
        return "last name"
    if "phone" in p or "fax" in p or "telephone" in p:
        return "phone number"
    if "md number" in p:
        return "medical license number"
    if "job number" in p:
        return "job id"
    if "numeric identifier" in p:
        return "numeric id"
    if "hospital ward" in p:
        return "hospital ward"
    if "hospital unit" in p:
        return "hospital unit"
    if "hospital" in p:
        return "hospital"
    if "location" in p:
        return "location"
    if "country" in p:
        return "country"
    if "apartment address" in p:
        return "apartment address"
    if "street address" in p:
        return "street address"
    if "date range" in p:
        return "date range"
    if "month (only)" in p:
        return "month only"
    if "month/day/year" in p:
        return "full date"
    if "month/day" in p:
        return "month day"
    if "month/year" in p:
        return "month year"
    if re.match(fulldatepattern, p):
        return "full date"
    if re.match(monthdaypattern, p):
        return "month day"
    if (
        re.match(monthyearpattern, p)
        or re.match(monthyearpattern2, p)
        or re.match(monthyearpattern3, p)
    ):
        return "month year"
    if "age" in p and "90" in p:
        return "age over 90"
    if p.isdigit() and len(p) == 2:
        return "age"
    if "state" in p:
        return "state"
    if "name" in p:
        return "full name"
    if (p.isdigit() and len(p) == 4 and p[0:2] in ["21", "20", "22"]) or "year" in p:
        return "year"
    if "company" in p:
        return "company"
    if "medical record number" in p:
        return "medical record number"
    if "university" in p or "college" in p:
        return "university"
    if "unit number" in p:
        return "unit number"
    if "pager" in p:
        return "pager number"
    if "holiday" in p:
        return "holiday"
    if "serial number" in p:
        return "serial number"
    if "clip number" in p:
        return "clip number"
    if "dictator info" in p:
        return "dictator info"
    if "attending info" in p:
        return "attending info"
    if "cc contact info" in p:
        return "cc contact info"
    if any(month in p.lower() for month in _monthlist) and re.search(yearpattern, p):
        return "month year"
    if "social security number" in p:
        return "social security number"
    if "e-mail" in p:
        return "e-mail"
    if "-" in p and p[0].isdigit():
        return "full date"
    if p.strip().isdigit() and len(p.strip()) > 2:
        return "numeric id"
    if p.strip().isdigit() and len(p.strip()) <= 2:
        return "age"
    if "number" in p:
        return "numeric id"
    if "id" in p:
        return "numeric id"
    if "month day" in p:
        return "month day alpha"
    if "day month" in p:
        return "day month alpha"
    if "month year" in p:
        return "month year alpha"
    if "year month" in p:
        return "year month alpha"
    if "po box" in p:
        return "po box"
    if "url" in p:
        return "url"
    if "-" in p:
        return "full date"
    if p == " " or p == "":
        return "blank"
    return "other"


def get_replaced_text(
    entity: str,
    randformat: dict[str, object] | None = None,
) -> tuple[str, str] | None:
    """
    Return ``(surface_text, brat_entity_type)`` or ``None`` if unsupported.

    ``randformat`` defaults to :func:`getrandformat` when omitted.
    """
    fake = get_faker()
    if randformat is None:
        randformat = getrandformat()

    # names
    if entity == "first name":
        return (fake.first_name(), "PATIENT")
    if entity == "last name":
        return (fake.last_name(), "PATIENT")
    if entity in ("full name", "dictator info", "attending info", "cc contact info"):
        return (generate_name(), "PATIENT")

    # dates
    if entity == "full date":
        return (
            fake.full_date(
                pattern=str(randformat["fulldateformats"]),
                seperator=str(randformat["dateseperators"]),
                leadingzeroes=bool(randformat["leadingzeroes"]),
            ),
            "DATE",
        )
    if entity == "month day":
        return (
            fake.month_day(
                seperator=str(randformat["dateseperators"]),
                leadingzeroes=bool(randformat["leadingzeroes"]),
            ),
            "DATE",
        )
    if entity == "month year":
        return (
            fake.month_year(
                seperator=str(randformat["dateseperators"]),
                leadingzeroes=bool(randformat["leadingzeroes"]),
            ),
            "DATE",
        )
    if entity == "month day alpha":
        return (
            fake.month_day_alpha(
                abrv=bool(randformat["abrv"]),
                leadingzeroes=bool(randformat["leadingzeroes"]),
            ),
            "DATE",
        )
    if entity == "month year alpha":
        return (
            fake.month_year_alpha(
                abrv=bool(randformat["abrv"]),
                leadingzeroes=bool(randformat["leadingzeroes"]),
            ),
            "DATE",
        )
    if entity == "year month alpha":
        return (
            fake.year_month_alpha(
                abrv=bool(randformat["abrv"]),
                leadingzeroes=bool(randformat["leadingzeroes"]),
            ),
            "DATE",
        )
    if entity == "day month alpha":
        return (
            fake.day_month_alpha(
                abrv=bool(randformat["abrv"]),
                leadingzeroes=bool(randformat["leadingzeroes"]),
            ),
            "DATE",
        )
    if entity == "date range":
        start_date = fake.date_this_decade()
        end_date = start_date + timedelta(days=random.randint(1, 365))
        return (
            f"{start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}",
            "DATE",
        )
    if entity == "month only":
        return (
            random.choice(
                [
                    "January",
                    "February",
                    "March",
                    "April",
                    "May",
                    "June",
                    "July",
                    "August",
                    "September",
                    "October",
                    "November",
                    "December",
                ]
            ),
            "DATE",
        )
    if "year" in entity:
        return (str(random.randint(1900, 2024)), "DATE")

    # hospital
    if entity == "hospital":
        return (fake.hospital_namev2(), "HOSPITAL")
    if entity == "hospital ward":
        return (
            fake.hospital_ward(abrv=bool(randformat["abrv"])),
            "LOCATION_OTHER",
        )
    if entity == "hospital unit":
        return (
            fake.hospital_unit(abrv=bool(randformat["abrv"])),
            "LOCATION_OTHER",
        )

    if entity == "university":
        return (fake.university_name(), "LOCATION_OTHER")

    if entity == "phone number":
        area_code = str(fake.random_number(digits=3)).zfill(3)
        prefix = str(fake.random_number(digits=3)).zfill(3)
        line_number = str(fake.random_number(digits=4)).zfill(4)
        if random.random() < 0.5:
            return (f"({area_code}) {prefix}-{line_number}", "PHONE")
        return (f"{area_code}-{prefix}-{line_number}", "PHONE")
    if entity == "pager number":
        return (f"P{fake.random_number(digits=6)}", "PHONE")

    if entity == "medical license number":
        return (str(fake.random_number(digits=random.randint(6, 8))), "IDNUM")
    if entity == "job id":
        return (str(fake.random_number(digits=random.randint(4, 6))), "IDNUM")
    if entity == "numeric id":
        return (str(fake.random_number(digits=random.randint(4, 6))), "IDNUM")
    if entity == "unit number":
        return (f"UNIT{fake.random_number(digits=4)}", "IDNUM")
    if entity == "serial number":
        return (f"SN{fake.random_number(digits=10)}", "IDNUM")
    if entity == "clip number":
        return (f"CLIP{fake.random_number(digits=6)}", "IDNUM")
    if entity == "social security number":
        return (fake.ssn(), "IDNUM")
    if entity == "medical record number":
        return (f"MRN{fake.random_number(digits=8)}", "IDNUM")

    if entity == "e-mail":
        return (fake.email(), "EMAIL")

    if entity == "url":
        return (fake.url(), "URL")

    if entity == "age":
        return (str(random.randint(1, 89)), "AGE")
    if entity == "age over 90":
        return (str(random.randint(90, 110)), "AGE")

    if entity == "location":
        return (fake.street_name(), "LOCATION_OTHER")
    if entity == "apartment address":
        return (fake.building_number(), "LOCATION_OTHER")
    if entity == "street address":
        return (fake.building_number(), "LOCATION_OTHER")
    if entity == "po box":
        return (f"PO Box {fake.random_number(digits=5)}", "LOCATION_OTHER")

    if entity == "country":
        return (fake.country(), "COUNTRY")
    if entity == "state":
        return (fake.state(), "STATE")

    if entity == "company":
        return (fake.company(), "ORGANIZATION")

    if entity == "holiday":
        return (
            random.choice(
                [
                    "Christmas",
                    "Thanksgiving",
                    "New Year's Day",
                    "Independence Day",
                    "Labor Day",
                    "Memorial Day",
                    "Easter",
                ]
            ),
            "DATE",
        )

    if entity == "blank":
        return ("", "BLANK")

    logger.debug("no replacement template for entity %r", entity)
    return None
