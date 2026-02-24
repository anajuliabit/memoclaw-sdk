"""Auto-detect ~/.memoclaw/config.json created by `memoclaw init`."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class MemoClawConfig:
    """Configuration loaded from ~/.memoclaw/config.json."""

    wallet: str | None = None
    private_key: str | None = None
    url: str | None = None


_DEFAULT_CONFIG_PATH = Path.home() / ".memoclaw" / "config.json"


def load_config(path: str | Path | None = None) -> MemoClawConfig:
    """Load config from a JSON file.

    Resolution order for each field:
      1. Explicit constructor arg (handled by caller)
      2. Environment variable (MEMOCLAW_WALLET, MEMOCLAW_PRIVATE_KEY, MEMOCLAW_URL)
      3. Config file (~/.memoclaw/config.json)

    Args:
        path: Override path to config file. Defaults to ``~/.memoclaw/config.json``.

    Returns:
        A :class:`MemoClawConfig` with values from the config file (if it exists).
        Missing file → empty config (no error).
    """
    config_path = Path(path) if path else _DEFAULT_CONFIG_PATH

    cfg = MemoClawConfig()

    if config_path.is_file():
        try:
            data = json.loads(config_path.read_text(encoding="utf-8"))
            cfg.wallet = data.get("wallet")
            cfg.private_key = data.get("privateKey") or data.get("private_key")
            cfg.url = data.get("url") or data.get("baseUrl") or data.get("base_url")
        except (json.JSONDecodeError, OSError):
            pass  # Silently ignore malformed config

    return cfg


def resolve_private_key(
    explicit: str | None = None,
    config: MemoClawConfig | None = None,
    *,
    wallet_address: str | None = None,
) -> str | None:
    """Resolve private key from explicit arg > env var > config file.

    When *wallet_address* is provided the private key becomes optional —
    the caller can operate in wallet-only (read-only) mode.

    Returns:
        The private key string, or ``None`` when wallet-only mode is used.

    Raises:
        ValueError: If neither a private key nor a wallet address can be found.
    """
    if explicit is not None:
        return explicit

    # Only auto-resolve from env/config when wallet-only auth is NOT requested
    if wallet_address is None:
        env_key = os.environ.get("MEMOCLAW_PRIVATE_KEY")
        if env_key:
            return env_key

        if config and config.private_key:
            return config.private_key

    else:
        # Even in wallet-only mode, still pick up a key if explicitly set in env
        env_key = os.environ.get("MEMOCLAW_PRIVATE_KEY")
        if env_key:
            return env_key
        if config and config.private_key:
            return config.private_key
        # No key found — that's fine in wallet-only mode
        return None

    raise ValueError(
        "No private key provided. Pass private_key=, set MEMOCLAW_PRIVATE_KEY, "
        "or run `memoclaw init` to create ~/.memoclaw/config.json. "
        "Alternatively, pass wallet_address= for read-only access to free endpoints."
    )


def resolve_wallet_address(
    explicit: str | None = None,
    config: MemoClawConfig | None = None,
) -> str | None:
    """Resolve wallet address from explicit arg > env var > config file.

    Returns ``None`` if no wallet address is available (private key mode
    derives the address automatically).
    """
    if explicit is not None:
        return explicit

    env_wallet = os.environ.get("MEMOCLAW_WALLET")
    if env_wallet:
        return env_wallet

    if config and config.wallet:
        return config.wallet

    return None


def resolve_base_url(
    explicit: str | None = None,
    config: MemoClawConfig | None = None,
    default: str = "https://api.memoclaw.com",
) -> str:
    """Resolve base URL from explicit arg > env var > config file > default."""
    if explicit is not None:
        return explicit

    env_url = os.environ.get("MEMOCLAW_URL")
    if env_url:
        return env_url

    if config and config.url:
        return config.url

    return default
