from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Self

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from clinical_deid.env_file import resolve_env_file_path
from clinical_deid.synthesis.client import OpenAICompatibleChatClient

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    database_url: str = "sqlite:///./var/dev.sqlite"
    pipelines_dir: Path = Path("pipelines")
    evaluations_dir: Path = Path("evaluations")
    inference_runs_dir: Path = Path("inference_runs")
    models_dir: Path = Path("models")
    datasets_dir: Path = Path("datasets")
    #: Root for materialized corpus bytes (transform / compose / generate outputs, BRAT exports).
    #: Flat layout: ``$PROCESSED_DIR/{dataset_name}.jsonl`` for JSONL, ``$PROCESSED_DIR/{name}_export/`` for exports.
    processed_dir: Path = Path("data/processed")
    dictionaries_dir: Path = Path("data/dictionaries")
    cors_origins: list[str] = Field(
        default=["http://localhost:3000", "http://127.0.0.1:3000"],
        description="Allowed CORS origins for the API.",
    )
    #: API keys with admin scope. When empty AND ``inference_api_keys`` is empty, auth is disabled.
    admin_api_keys: list[str] = Field(
        default_factory=list,
        description=(
            "Admin-scope API keys. Accepted as 'Authorization: Bearer <key>' or 'X-API-Key: <key>'. "
            "Admin scope covers all mutation routes and also satisfies inference-scoped routes."
        ),
    )
    #: API keys with inference scope. When empty AND ``admin_api_keys`` is empty, auth is disabled.
    inference_api_keys: list[str] = Field(
        default_factory=list,
        description=(
            "Inference-scope API keys. Accepted as 'Authorization: Bearer <key>' or 'X-API-Key: <key>'. "
            "Inference scope covers /process/* (subject to the deploy allowlist)."
        ),
    )
    #: Reject requests with Content-Length above this (bytes). Defaults to 10 MiB.
    max_body_bytes: int = Field(
        default=10 * 1024 * 1024,
        description=(
            "Upper bound on request body size (bytes). Requests with a larger Content-Length "
            "are rejected with 413 before the route handler runs. "
            "File uploads (dictionaries, list parsers) enforce their own stricter per-file limit."
        ),
    )

    #: For :class:`~clinical_deid.synthesis.client.OpenAICompatibleChatClient`. Loaded from ``.env`` or the environment. Either ``OPENAI_API_KEY`` or ``CLINICAL_DEID_OPENAI_API_KEY`` may be set.
    openai_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("OPENAI_API_KEY", "CLINICAL_DEID_OPENAI_API_KEY"),
    )
    openai_base_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("OPENAI_BASE_URL", "CLINICAL_DEID_OPENAI_BASE_URL"),
    )
    openai_model: str = Field(
        default="gpt-4o-mini",
        validation_alias=AliasChoices("OPENAI_MODEL", "CLINICAL_DEID_OPENAI_MODEL"),
    )
    #: Base URL for the NeuroNER Docker HTTP sidecar (overridable per pipe via ``base_url`` on :class:`~clinical_deid.pipes.neuroner_ner.pipe.NeuroNerConfig`).
    neuroner_http_url: str = Field(
        default="http://127.0.0.1:8765",
        validation_alias=AliasChoices(
            "CLINICAL_DEID_NEURONER_HTTP_URL",
            "NEURONER_HTTP_URL",
        ),
    )

    model_config = SettingsConfigDict(
        env_prefix="CLINICAL_DEID_",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    def __init__(self, **data: Any) -> None:
        if "_env_file" not in data:
            env_path = resolve_env_file_path()
            if env_path is not None:
                data["_env_file"] = str(env_path)
        super().__init__(**data)

    @model_validator(mode="after")
    def _legacy_corpora_dir_env(self) -> Self:
        """``CLINICAL_DEID_CORPORA_DIR`` still works (deprecated alias for ``processed_dir``)."""
        if (
            os.environ.get("CLINICAL_DEID_CORPORA_DIR")
            and not os.environ.get("CLINICAL_DEID_PROCESSED_DIR")
        ):
            logger.warning(
                "CLINICAL_DEID_CORPORA_DIR is deprecated; rename to CLINICAL_DEID_PROCESSED_DIR."
            )
            # Mutate in place: Pydantic v2 ignores a returned ``model_copy`` from ``__init__`` validation.
            self.processed_dir = Path(os.environ["CLINICAL_DEID_CORPORA_DIR"])
        return self

    @property
    def sqlite_path(self) -> Path | None:
        if self.database_url.startswith("sqlite:///./"):
            return Path(self.database_url.removeprefix("sqlite:///./"))
        if self.database_url.startswith("sqlite:///"):
            # absolute path: sqlite:////tmp/foo.db has four slashes
            rest = self.database_url.removeprefix("sqlite:///")
            if rest.startswith("/"):
                return Path(rest)
        return None

    def openai_chat_client(self) -> OpenAICompatibleChatClient:
        """Build a chat client from these settings; raises if no API key is configured."""
        if not self.openai_api_key:
            raise ValueError(
                "OpenAI API key is not set. Add OPENAI_API_KEY (or CLINICAL_DEID_OPENAI_API_KEY) "
                "to your environment or a ``.env`` file in the project root (see ``.env.example``)."
            )
        base = self.openai_base_url or "https://api.openai.com/v1"
        return OpenAICompatibleChatClient(
            model=self.openai_model,
            api_key=self.openai_api_key,
            base_url=base,
        )


_settings: Settings | None = None


def get_settings() -> Settings:
    """Return a cached :class:`Settings` singleton (reads ``.env`` only once)."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def reset_settings() -> None:
    """Test helper: clear cached settings so the next call re-reads the environment."""
    global _settings
    _settings = None
