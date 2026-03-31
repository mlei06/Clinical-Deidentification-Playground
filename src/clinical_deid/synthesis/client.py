"""LLM backends: protocol + OpenAI-compatible HTTP client."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from clinical_deid.synthesis.types import ChatMessage


@runtime_checkable
class LLMClient(Protocol):
    """Minimal interface for :class:`LLMSynthesizer`."""

    def complete(self, messages: list[ChatMessage], **kwargs: Any) -> str:
        """Return assistant text (one turn). kwargs may include temperature, etc."""


class OpenAICompatibleChatClient:
    """
    Chat Completions API (OpenAI or compatible base URL).

    Requires ``httpx``: ``pip install clinical-deid-playground[llm]``.
    """

    def __init__(
        self,
        *,
        model: str,
        api_key: str,
        base_url: str = "https://api.openai.com/v1",
        timeout_s: float = 120.0,
        default_headers: dict[str, str] | None = None,
    ) -> None:
        self.model = model
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self.default_headers = default_headers or {}

    def complete(self, messages: list[ChatMessage], **kwargs: Any) -> str:
        try:
            import httpx
        except ImportError as e:
            raise ImportError(
                "OpenAICompatibleChatClient requires httpx; "
                "install with: pip install clinical-deid-playground[llm]"
            ) from e

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [m.model_dump() for m in messages],
        }
        if "temperature" in kwargs:
            payload["temperature"] = kwargs["temperature"]
        if "max_tokens" in kwargs:
            payload["max_tokens"] = kwargs["max_tokens"]

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            **self.default_headers,
        }
        url = f"{self.base_url}/chat/completions"
        with httpx.Client(timeout=self.timeout_s) as client:
            r = client.post(url, json=payload, headers=headers)
            r.raise_for_status()
            data = r.json()

        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError(f"LLM response missing choices: {data!r}")
        msg = choices[0].get("message") or {}
        content = msg.get("content")
        if not content:
            raise RuntimeError(f"LLM response missing message content: {data!r}")
        return str(content).strip()


class StaticResponseClient:
    """Test double or canned demo: always returns the same assistant string."""

    def __init__(self, text: str) -> None:
        self._text = text

    def complete(self, messages: list[ChatMessage], **kwargs: Any) -> str:
        del messages, kwargs
        return self._text
