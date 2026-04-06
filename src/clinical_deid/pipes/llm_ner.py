"""LLM-prompted NER detector.

Sends document text to an OpenAI-compatible LLM with a structured prompt
asking it to identify PHI spans, then parses the JSON response back into
:class:`~clinical_deid.domain.PHISpan` objects.

Requires ``pip install clinical-deid-playground[llm]`` (httpx).
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from pydantic import BaseModel, Field

from clinical_deid.domain import AnnotatedDocument, PHISpan
from clinical_deid.pipes.base import ConfigurablePipe

logger = logging.getLogger(__name__)

_DEFAULT_LABELS = [
    "PATIENT", "DOCTOR", "DATE", "HOSPITAL", "ID", "PHONE", "EMAIL",
    "LOCATION", "AGE", "SSN", "MRN",
]

_DEFAULT_PROMPT_TEMPLATE = """\
You are a clinical de-identification system. Identify all Protected Health Information (PHI) \
in the following clinical text.

Return a JSON array of objects, each with keys: "start" (int, character offset), \
"end" (int, character offset), "label" (string, one of: {labels}).

Rules:
- Offsets are 0-based character positions in the original text.
- "start" is inclusive, "end" is exclusive.
- Only use the labels listed above.
- If no PHI is found, return an empty array: []
- Return ONLY the JSON array, no other text.

Clinical text:
---
{text}
---
"""


class LlmNerConfig(BaseModel):
    """Configuration for LLM-based NER."""

    model: str = Field(
        default="gpt-4o-mini",
        description="Model name for the LLM API.",
    )
    base_url: str | None = Field(
        default=None,
        description="Base URL for the OpenAI-compatible API. None uses settings default.",
    )
    api_key_env: str = Field(
        default="OPENAI_API_KEY",
        description="Environment variable name holding the API key (not the key itself).",
    )
    labels: list[str] = Field(
        default_factory=lambda: list(_DEFAULT_LABELS),
        description="Entity labels the LLM should detect.",
    )
    temperature: float = Field(
        default=0.0,
        ge=0.0,
        le=2.0,
        description="Sampling temperature for the LLM.",
    )
    prompt_template: str | None = Field(
        default=None,
        description="Custom prompt template with {text} and {labels} placeholders.",
    )
    source_name: str = Field(
        default="llm_ner",
        description="Source tag for detected spans.",
    )
    max_text_length: int = Field(
        default=30_000,
        description="Truncate input text beyond this length to avoid token limits.",
    )


def _parse_llm_response(raw: str, text_length: int) -> list[dict[str, Any]]:
    """Extract JSON array from LLM response, tolerating markdown fences."""
    cleaned = raw.strip()
    # Strip markdown code fences
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        # Remove first and last fence lines
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()

    # Try parsing as JSON array
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        # Try to find a JSON array in the text
        match = re.search(r"\[.*\]", cleaned, re.DOTALL)
        if match:
            parsed = json.loads(match.group())
        else:
            logger.warning("Could not parse LLM response as JSON: %s", cleaned[:200])
            return []

    if not isinstance(parsed, list):
        return []

    # Validate and filter entries
    valid: list[dict[str, Any]] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        start = item.get("start")
        end = item.get("end")
        label = item.get("label")
        if (
            isinstance(start, int)
            and isinstance(end, int)
            and isinstance(label, str)
            and 0 <= start < end <= text_length
        ):
            valid.append(item)

    return valid


class LlmNerPipe(ConfigurablePipe):
    """Detector that uses an LLM to identify PHI spans."""

    def __init__(self, config: LlmNerConfig | None = None) -> None:
        self._config = config or LlmNerConfig()

    @property
    def labels(self) -> set[str]:
        return set(self._config.labels)

    def _get_client(self):
        from clinical_deid.synthesis.client import OpenAICompatibleChatClient

        api_key = os.environ.get(self._config.api_key_env, "")
        if not api_key:
            raise RuntimeError(
                f"LLM NER requires API key in environment variable "
                f"{self._config.api_key_env!r}"
            )
        base_url = self._config.base_url or "https://api.openai.com/v1"
        return OpenAICompatibleChatClient(
            model=self._config.model,
            api_key=api_key,
            base_url=base_url,
        )

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        from clinical_deid.synthesis.types import ChatMessage

        text = doc.document.text
        if not text.strip():
            return doc

        # Truncate if too long
        if len(text) > self._config.max_text_length:
            text = text[: self._config.max_text_length]

        template = self._config.prompt_template or _DEFAULT_PROMPT_TEMPLATE
        labels_str = ", ".join(self._config.labels)
        prompt = template.format(text=text, labels=labels_str)

        client = self._get_client()
        messages = [ChatMessage(role="user", content=prompt)]

        try:
            raw_response = client.complete(
                messages,
                temperature=self._config.temperature,
            )
        except Exception:
            logger.exception("LLM NER call failed")
            return doc

        parsed = _parse_llm_response(raw_response, len(doc.document.text))
        allowed_labels = set(self._config.labels)
        spans: list[PHISpan] = []
        for item in parsed:
            if item["label"] not in allowed_labels:
                continue
            spans.append(
                PHISpan(
                    start=item["start"],
                    end=item["end"],
                    label=item["label"],
                    confidence=item.get("confidence"),
                    source=self._config.source_name,
                )
            )

        all_spans = list(doc.spans) + spans
        all_spans.sort(key=lambda s: (s.start, s.end))
        return doc.with_spans(all_spans)
