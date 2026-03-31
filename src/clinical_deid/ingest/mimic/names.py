"""Synthetic multi-locale person names (from Neuroner MIMIC data-generation scripts)."""

from __future__ import annotations

import random

from faker import Faker

locale_weights = {
    "en_US": 0.4,
    "en_GB": 0.2,
    "en_CA": 0.1,
    "zh_CN": 0.1,
    "ja_JP": 0.05,
    "ko_KR": 0.05,
    "hi_IN": 0.05,
    "ar_EG": 0.05,
}

custom_names = {
    "zh_CN": {
        "first": ["Wei", "Jing", "Ming", "Li", "Xiao", "Bo", "Ying"],
        "last": ["Wang", "Chen", "Zhao", "Liu", "Huang", "Zhang"],
    },
    "ja_JP": {
        "first": ["Haruto", "Yui", "Souta", "Sakura", "Ren", "Hina"],
        "last": ["Takahashi", "Yamamoto", "Kobayashi", "Tanaka"],
    },
    "ko_KR": {
        "first": ["Minjun", "Seo-yeon", "Jisoo", "Hyunwoo", "Eunji"],
        "last": ["Kim", "Lee", "Park", "Choi", "Jung"],
    },
    "hi_IN": {
        "first": ["Aarav", "Diya", "Vivaan", "Anaya", "Rohan"],
        "last": ["Patel", "Sharma", "Mehta", "Reddy", "Singh"],
    },
    "ar_EG": {
        "first": ["Omar", "Youssef", "Laila", "Amira", "Hassan"],
        "last": ["Mahmoud", "Fahmy", "Nassar", "Saad"],
    },
}

_fakers = {loc: Faker(loc) for loc in locale_weights if loc.startswith("en")}


def generate_name() -> str:
    locale = random.choices(
        population=list(locale_weights.keys()),
        weights=list(locale_weights.values()),
        k=1,
    )[0]

    if locale.startswith("en"):
        fake = _fakers[locale]
        first = fake.first_name()
        last = fake.last_name()
    else:
        first = random.choice(custom_names[locale]["first"])
        last = random.choice(custom_names[locale]["last"])

    format_style = random.choice(
        [
            "full_title",
            "full_lower",
            "initial_title",
            "initial_lower",
        ]
    )

    if format_style == "full_title":
        return f"{first.capitalize()} {last.capitalize()}"
    if format_style == "full_lower":
        return f"{first.lower()} {last.lower()}"
    if format_style == "initial_title":
        return f"{first[0].upper()}. {last.capitalize()}"
    return f"{first[0].lower()}. {last.lower()}"
