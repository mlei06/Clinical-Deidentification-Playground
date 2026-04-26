"""LLM-prompted NER detector.

Sends document text to an OpenAI-compatible LLM with a structured prompt
asking it to identify PHI spans, then parses the JSON response back into
:class:`~clinical_deid.domain.EntitySpan` objects.

Requires ``pip install clinical-deid-playground[llm]`` (httpx).
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Literal

from pydantic import BaseModel, Field

from clinical_deid.domain import AnnotatedDocument, EntitySpan
from clinical_deid.pipes.base import ConfigurablePipe
from clinical_deid.pipes.detector_label_mapping import accumulate_spans
from clinical_deid.pipes.ui_schema import field_ui

logger = logging.getLogger(__name__)

_DEFAULT_LABELS = [
    "PATIENT", "DOCTOR", "DATE", "HOSPITAL", "ID", "PHONE", "EMAIL",
    "LOCATION", "AGE", "SSN", "MRN",
]

_DEFAULT_PROMPT_TEMPLATE = """\
You are a clinical de-identification system. Identify all Protected Health Information (PHI) \
in the following clinical text.

Return a JSON object with a single key "spans" whose value is an array of objects, each with \
keys: "start" (int, character offset), "end" (int, character offset), "label" (string, one of: \
{labels}).

Rules:
- Offsets are 0-based character positions in the original text.
- "start" is inclusive, "end" is exclusive.
- Only use the labels listed above.
- If no PHI is found, return: {{"spans": []}}
- Return ONLY the JSON object, no other text.

Clinical text:
---
{text}
---
"""

_FIXED_TEMPERATURE_MODEL_PREFIXES: tuple[str, ...] = (
    "gpt-5",
    "o1",
    "o3",
    "o4",
)


def _supports_custom_temperature(model: str) -> bool:
    return not model.startswith(_FIXED_TEMPERATURE_MODEL_PREFIXES)


KnownLlmModel = Literal[
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "o3",
    "o4-mini",
    "gpt-4o",
    "gpt-4o-mini",
]

_MODEL_DESCRIPTIONS: dict[str, str] = {
    "gpt-5": "GPT-5 — flagship model, highest accuracy on complex extraction.",
    "gpt-5-mini": "GPT-5 Mini — strong accuracy at a fraction of the cost.",
    "gpt-5-nano": "GPT-5 Nano — cheapest GPT-5 tier, fast structured extraction.",
    "gpt-4.1": "GPT-4.1 — high accuracy, large 1M-token context window.",
    "gpt-4.1-mini": "GPT-4.1 Mini — balanced speed and accuracy, long context.",
    "gpt-4.1-nano": "GPT-4.1 Nano — cheapest 4.1-tier, fast lightweight extraction.",
    "o3": "o3 — reasoning model, best on hard cases requiring multi-step inference.",
    "o4-mini": "o4-mini — reasoning model, fast and inexpensive for tricky cases.",
    "gpt-4o": "GPT-4o — legacy flagship, fast and accurate.",
    "gpt-4o-mini": "GPT-4o Mini — legacy small model, low-cost structured extraction.",
}


def default_base_labels() -> list[str]:
    """Default label space for the llm_ner detector."""
    return sorted(_DEFAULT_LABELS)


class LlmNerConfig(BaseModel):
    """Configuration for LLM-based NER."""

    model: KnownLlmModel = Field(
        default="gpt-4o-mini",
        description="OpenAI model to use.",
        json_schema_extra=field_ui(
            ui_group="Model",
            ui_order=1,
            ui_widget="described_select",
            ui_enum_descriptions=_MODEL_DESCRIPTIONS,
        ),
    )
    temperature: float = Field(
        default=0.0,
        ge=0.0,
        le=2.0,
        description="Sampling temperature (0 = deterministic).",
        json_schema_extra={
            "multipleOf": 0.05,
            **field_ui(
                ui_group="Model",
                ui_order=2,
                ui_widget="slider",
            ),
        },
    )
    labels: list[str] = Field(
        default_factory=lambda: list(_DEFAULT_LABELS),
        description="Entity labels injected into the prompt. The LLM will only detect these.",
        json_schema_extra={
            "default": list(_DEFAULT_LABELS),
            **field_ui(
                ui_group="Labels",
                ui_order=1,
                ui_widget="tag_list",
            ),
        },
    )
    prompt_template: str = Field(
        default=_DEFAULT_PROMPT_TEMPLATE,
        description="Prompt template sent to the LLM. Use {text} and {labels} placeholders.",
        json_schema_extra={
            "default": _DEFAULT_PROMPT_TEMPLATE,
            **field_ui(
                ui_group="Prompt",
                ui_order=1,
                ui_widget="textarea",
                ui_rows=14,
            ),
        },
    )
    max_text_length: int = Field(
        default=30_000,
        description="Truncate input text beyond this length to avoid token limits.",
        json_schema_extra=field_ui(
            ui_group="Advanced",
            ui_order=1,
            ui_widget="number",
            ui_advanced=True,
        ),
    )
    base_url: str | None = Field(
        default=None,
        description="Base URL for an OpenAI-compatible API. None uses the default.",
        json_schema_extra=field_ui(
            ui_group="Advanced",
            ui_order=2,
            ui_widget="text",
            ui_advanced=True,
        ),
    )
    api_key_env: str = Field(
        default="OPENAI_API_KEY",
        description="Environment variable name holding the API key.",
        json_schema_extra=field_ui(
            ui_group="Advanced",
            ui_order=3,
            ui_widget="text",
            ui_advanced=True,
        ),
    )
    source_name: str = Field(
        default="llm_ner",
        description="Source tag for detected spans.",
        json_schema_extra=field_ui(
            ui_group="Advanced",
            ui_order=4,
            ui_widget="text",
            ui_advanced=True,
        ),
    )
    skip_overlapping: bool = Field(
        default=False,
        description="Drop new spans that overlap any existing span in the document.",
        json_schema_extra=field_ui(
            ui_group="General",
            ui_order=99,
            ui_widget="switch",
        ),
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

    # Try parsing as JSON
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        # Try to find a JSON object or array in the text
        match = re.search(r"\{.*\}|\[.*\]", cleaned, re.DOTALL)
        if match:
            parsed = json.loads(match.group())
        else:
            logger.warning("Could not parse LLM response as JSON (response length: %d chars)", len(cleaned))
            return []

    # Accept either {"spans": [...]} or a bare [...] for back-compat.
    if isinstance(parsed, dict):
        parsed = parsed.get("spans", [])
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
        self._cached_client: Any = None

    @property
    def base_labels(self) -> set[str]:
        return set(self._config.labels)

    @property
    def labels(self) -> set[str]:
        return set(self._config.labels)

    def _get_client(self):
        if self._cached_client is not None:
            return self._cached_client

        from clinical_deid.synthesis.client import OpenAICompatibleChatClient

        api_key = os.environ.get(self._config.api_key_env, "")
        if not api_key and self._config.api_key_env in {
            "OPENAI_API_KEY",
            "CLINICAL_DEID_OPENAI_API_KEY",
        }:
            from clinical_deid.config import get_settings

            api_key = get_settings().openai_api_key or ""
        if not api_key:
            raise RuntimeError(
                f"LLM NER requires API key in environment variable "
                f"{self._config.api_key_env!r}"
            )
        base_url = self._config.base_url or "https://api.openai.com/v1"
        self._cached_client = OpenAICompatibleChatClient(
            model=self._config.model,
            api_key=api_key,
            base_url=base_url,
        )
        return self._cached_client

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        from clinical_deid.synthesis.types import ChatMessage

        text = doc.document.text
        if not text.strip():
            return doc

        llm_text = text
        if len(text) > self._config.max_text_length:
            llm_text = text[: self._config.max_text_length]
            logger.info(
                "LLM NER: truncated text from %d to %d chars", len(text), len(llm_text)
            )

        template = self._config.prompt_template or _DEFAULT_PROMPT_TEMPLATE
        labels_str = ", ".join(self._config.labels)
        prompt = template.format(text=llm_text, labels=labels_str)

        client = self._get_client()
        messages = [ChatMessage(role="user", content=prompt)]

        complete_kwargs: dict[str, Any] = {
            "response_format": {"type": "json_object"},
        }
        if _supports_custom_temperature(self._config.model):
            complete_kwargs["temperature"] = self._config.temperature

        try:
            raw_response = client.complete(messages, **complete_kwargs)
        except Exception:
            logger.exception("LLM NER call failed")
            return doc

        parsed = _parse_llm_response(raw_response, len(llm_text))
        allowed_labels = set(self._config.labels)
        spans: list[EntitySpan] = []
        for item in parsed:
            if item["label"] not in allowed_labels:
                continue
            spans.append(
                EntitySpan(
                    start=item["start"],
                    end=item["end"],
                    label=item["label"],
                    confidence=item.get("confidence"),
                    source=self._config.source_name,
                )
            )

        return accumulate_spans(doc, spans, skip_overlapping=self._config.skip_overlapping)
