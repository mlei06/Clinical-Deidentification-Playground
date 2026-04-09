from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from clinical_deid.env_file import resolve_env_file_path
from clinical_deid.synthesis.client import OpenAICompatibleChatClient


class Settings(BaseSettings):
    database_url: str = "sqlite:///./var/dev.sqlite"
    pipelines_dir: Path = Path("pipelines")
    evaluations_dir: Path = Path("evaluations")
    models_dir: Path = Path("models")
    dictionaries_dir: Path = Path("data/dictionaries")
    cors_origins: list[str] = Field(
        default=["http://localhost:3000", "http://127.0.0.1:3000"],
        description="Allowed CORS origins for the API.",
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
