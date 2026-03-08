"""Internal HTTP transport with wallet auth, x402 payment fallback, and retry logic."""

from __future__ import annotations

import json as _json
import logging
import random
import time
from typing import Any, Literal

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_account.signers.local import LocalAccount

from .errors import APIError, PaymentRequiredError

logger = logging.getLogger("memoclaw")

# Log level names accepted by the SDK
LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
LogFormat = Literal["text", "json"]

# Map string level names to logging constants
_LEVEL_MAP: dict[str, int] = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
    "CRITICAL": logging.CRITICAL,
}


class _StructuredJsonFormatter(logging.Formatter):
    """Emit log records as single-line JSON objects for observability pipelines."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        # Attach extra structured fields set by the SDK
        for key in ("method", "path", "status", "duration_ms", "request_id"):
            val = getattr(record, key, None)
            if val is not None:
                entry[key] = val
        return _json.dumps(entry, default=str)


def configure_sdk_logging(
    level: LogLevel | int = "DEBUG",
    log_format: LogFormat = "text",
) -> None:
    """Configure the ``memoclaw`` logger with the given level and format.

    This is called automatically when ``log_level`` or ``log_format`` is passed
    to the client constructor, but can also be called manually.

    Args:
        level: A Python logging level name or int (e.g. ``"INFO"`` or ``logging.DEBUG``).
        log_format: ``"text"`` for human-readable output, ``"json"`` for structured JSON.
    """
    int_level = _LEVEL_MAP.get(level, level) if isinstance(level, str) else level  # type: ignore[arg-type]
    sdk_logger = logging.getLogger("memoclaw")
    sdk_logger.setLevel(int_level)

    # Remove existing handlers added by the SDK to avoid duplicates
    sdk_logger.handlers = [h for h in sdk_logger.handlers if not getattr(h, "_memoclaw_sdk", False)]

    handler = logging.StreamHandler()
    handler._memoclaw_sdk = True  # type: ignore[attr-defined]
    handler.setLevel(int_level)

    if log_format == "json":
        handler.setFormatter(_StructuredJsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))

    sdk_logger.addHandler(handler)

DEFAULT_BASE_URL = "https://api.memoclaw.com"
DEFAULT_TIMEOUT = 30.0
DEFAULT_MAX_RETRIES = 2

# Default connection pool limits
DEFAULT_POOL_MAX_CONNECTIONS = 10
DEFAULT_POOL_MAX_KEEPALIVE_CONNECTIONS = 5

# Status codes that are safe to retry (transient server errors)
_RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}

# Base delay between retries in seconds (exponential backoff: base * 2^attempt)
_RETRY_BASE_DELAY = 0.5


def _generate_wallet_auth(account: LocalAccount) -> str:
    """Generate ``{address}:{timestamp}:{signature}`` auth header."""
    timestamp = str(int(time.time()))
    message = f"memoclaw-auth:{timestamp}"
    signed = account.sign_message(encode_defunct(text=message))
    return f"{account.address}:{timestamp}:{signed.signature.hex()}"


def _generate_wallet_only_auth(wallet_address: str) -> str:
    """Generate a plain wallet address auth header for read-only access."""
    return wallet_address


def _raise_for_status(response: httpx.Response) -> None:
    """Raise a typed :class:`APIError` for non-2xx responses."""
    if response.is_success:
        return
    try:
        body = response.json()
    except Exception:
        body = {"error": {"code": "UNKNOWN", "message": response.text}}
    request_id = response.headers.get("x-request-id")
    raise APIError.from_response(response.status_code, body, request_id=request_id)


def _is_retryable(exc: BaseException) -> bool:
    """Check if an exception is retryable (network errors)."""
    return isinstance(exc, (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout))


def _try_x402_payment(
    response: httpx.Response,
) -> dict[str, str] | None:
    """Attempt to create an x402 payment from a 402 response.

    Returns payment headers on success, or ``None`` if x402 is unavailable.
    """
    try:
        from x402.httpx import create_payment_headers
    except ImportError:
        return None

    try:
        result: dict[str, str] = create_payment_headers(response)
        return result
    except Exception:
        return None


# ── Sync client ──────────────────────────────────────────────────────────────


class _SyncHTTPClient:
    def __init__(
        self,
        private_key: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        pool_max_connections: int = DEFAULT_POOL_MAX_CONNECTIONS,
        pool_max_keepalive: int = DEFAULT_POOL_MAX_KEEPALIVE_CONNECTIONS,
        wallet_address: str | None = None,
    ) -> None:
        if private_key is not None:
            self._account: LocalAccount | None = Account.from_key(private_key)
            self._wallet_address = self._account.address
        elif wallet_address is not None:
            self._account = None
            self._wallet_address = wallet_address
        else:
            raise ValueError(
                "Either private_key or wallet_address must be provided."
            )
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._max_retries = max_retries
        
        # Configure connection pool limits for better performance
        limits = httpx.Limits(
            max_connections=pool_max_connections,
            max_keepalive_connections=pool_max_keepalive,
        )
        self._http = httpx.Client(timeout=timeout, limits=limits)

    def request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> Any:
        url = f"{self._base_url}{path}"
        last_exc: BaseException | None = None
        req_timeout = timeout if timeout is not None else self._timeout

        logger.debug("%s %s", method, path)
        start = time.monotonic()

        for attempt in range(self._max_retries + 1):
            # Generate fresh auth header each attempt (timestamp-based)
            if self._account is not None:
                headers = {"x-wallet-auth": _generate_wallet_auth(self._account)}
            else:
                headers = {"x-wallet-auth": _generate_wallet_only_auth(self._wallet_address)}

            try:
                response = self._http.request(
                    method, url, headers=headers, json=json, params=params,
                    timeout=req_timeout,
                )
            except (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout) as exc:
                last_exc = exc
                if attempt < self._max_retries:
                    delay = _RETRY_BASE_DELAY * (2**attempt)
                    jitter = delay * 0.25 * random.random()
                    logger.debug("Network error on %s %s, retrying (attempt %d/%d)", method, path, attempt + 1, self._max_retries)
                    time.sleep(delay + jitter)
                    continue
                raise

            duration_ms = round((time.monotonic() - start) * 1000)
            req_id = response.headers.get("x-request-id", "")
            logger.debug(
                "%s %s → %d (%dms)%s",
                method, path, response.status_code, duration_ms,
                f" req={req_id}" if req_id else "",
                extra={
                    "method": method,
                    "path": path,
                    "status": response.status_code,
                    "duration_ms": duration_ms,
                    "request_id": req_id or None,
                },
            )

            # 402 → attempt x402 payment and retry once
            if response.status_code == 402:
                payment_headers = _try_x402_payment(response)
                if payment_headers:
                    headers.update(payment_headers)
                    response = self._http.request(
                        method, url, headers=headers, json=json, params=params,
                        timeout=req_timeout,
                    )

            # Retry on transient server errors (429, 500, 502, 503, 504)
            if response.status_code in _RETRYABLE_STATUS_CODES and attempt < self._max_retries:
                retry_after = response.headers.get("retry-after")
                if retry_after and retry_after.isdigit():
                    delay = float(retry_after)
                else:
                    delay = _RETRY_BASE_DELAY * (2**attempt)
                    delay += delay * 0.25 * random.random()
                logger.info(
                    "Retrying %s %s in %.1fs (attempt %d/%d)",
                    method, path, delay, attempt + 1, self._max_retries,
                    extra={"method": method, "path": path},
                )
                time.sleep(delay)
                continue

            _raise_for_status(response)

            if response.status_code == 204:
                return {}
            return response.json()

        # Should not reach here, but raise last error if we do
        if last_exc is not None:
            raise last_exc
        _raise_for_status(response)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> _SyncHTTPClient:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


# ── Async client ─────────────────────────────────────────────────────────────


class _AsyncHTTPClient:
    def __init__(
        self,
        private_key: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        pool_max_connections: int = DEFAULT_POOL_MAX_CONNECTIONS,
        pool_max_keepalive: int = DEFAULT_POOL_MAX_KEEPALIVE_CONNECTIONS,
        wallet_address: str | None = None,
    ) -> None:
        if private_key is not None:
            self._account: LocalAccount | None = Account.from_key(private_key)
            self._wallet_address = self._account.address
        elif wallet_address is not None:
            self._account = None
            self._wallet_address = wallet_address
        else:
            raise ValueError(
                "Either private_key or wallet_address must be provided."
            )
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._max_retries = max_retries
        
        # Configure connection pool limits for better performance
        limits = httpx.Limits(
            max_connections=pool_max_connections,
            max_keepalive_connections=pool_max_keepalive,
        )
        self._http = httpx.AsyncClient(timeout=timeout, limits=limits)

    async def request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> Any:
        import asyncio

        url = f"{self._base_url}{path}"
        last_exc: BaseException | None = None
        req_timeout = timeout if timeout is not None else self._timeout

        logger.debug("%s %s", method, path)
        start = time.monotonic()

        for attempt in range(self._max_retries + 1):
            if self._account is not None:
                headers = {"x-wallet-auth": _generate_wallet_auth(self._account)}
            else:
                headers = {"x-wallet-auth": _generate_wallet_only_auth(self._wallet_address)}

            try:
                response = await self._http.request(
                    method, url, headers=headers, json=json, params=params,
                    timeout=req_timeout,
                )
            except (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout) as exc:
                last_exc = exc
                if attempt < self._max_retries:
                    delay = _RETRY_BASE_DELAY * (2**attempt)
                    jitter = delay * 0.25 * random.random()
                    logger.debug("Network error on %s %s, retrying (attempt %d/%d)", method, path, attempt + 1, self._max_retries)
                    await asyncio.sleep(delay + jitter)
                    continue
                raise

            duration_ms = round((time.monotonic() - start) * 1000)
            req_id = response.headers.get("x-request-id", "")
            logger.debug(
                "%s %s → %d (%dms)%s",
                method, path, response.status_code, duration_ms,
                f" req={req_id}" if req_id else "",
                extra={
                    "method": method,
                    "path": path,
                    "status": response.status_code,
                    "duration_ms": duration_ms,
                    "request_id": req_id or None,
                },
            )

            # 402 → attempt x402 payment and retry once
            if response.status_code == 402:
                payment_headers = _try_x402_payment(response)
                if payment_headers:
                    headers.update(payment_headers)
                    response = await self._http.request(
                        method, url, headers=headers, json=json, params=params,
                        timeout=req_timeout,
                    )

            # Retry on transient server errors (429, 500, 502, 503, 504)
            if response.status_code in _RETRYABLE_STATUS_CODES and attempt < self._max_retries:
                retry_after = response.headers.get("retry-after")
                if retry_after and retry_after.isdigit():
                    delay = float(retry_after)
                else:
                    delay = _RETRY_BASE_DELAY * (2**attempt)
                    delay += delay * 0.25 * random.random()
                logger.info(
                    "Retrying %s %s in %.1fs (attempt %d/%d)",
                    method, path, delay, attempt + 1, self._max_retries,
                    extra={"method": method, "path": path},
                )
                await asyncio.sleep(delay)
                continue

            _raise_for_status(response)

            if response.status_code == 204:
                return {}
            return response.json()

        if last_exc is not None:
            raise last_exc
        _raise_for_status(response)

    async def close(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> _AsyncHTTPClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()
