"""Internal HTTP transport with wallet auth, x402 payment fallback, and retry logic."""

from __future__ import annotations

import time
from typing import Any

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct

from .errors import APIError, PaymentRequiredError

DEFAULT_BASE_URL = "https://api.memoclaw.com"
DEFAULT_TIMEOUT = 30.0
DEFAULT_MAX_RETRIES = 2

# Default connection pool limits
DEFAULT_POOL_MAX_CONNECTIONS = 10
DEFAULT_POOL_MAX_KEEPALIVE_CONNECTIONS = 5

# Status codes that are safe to retry (transient server errors)
_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}

# Base delay between retries in seconds (exponential backoff: base * 2^attempt)
_RETRY_BASE_DELAY = 0.5


def _generate_wallet_auth(account: Account) -> str:
    """Generate ``{address}:{timestamp}:{signature}`` auth header."""
    timestamp = str(int(time.time()))
    message = f"memoclaw-auth:{timestamp}"
    signed = account.sign_message(encode_defunct(text=message))
    return f"{account.address}:{timestamp}:{signed.signature.hex()}"


def _raise_for_status(response: httpx.Response) -> None:
    """Raise a typed :class:`APIError` for non-2xx responses."""
    if response.is_success:
        return
    try:
        body = response.json()
    except Exception:
        body = {"error": {"code": "UNKNOWN", "message": response.text}}
    raise APIError.from_response(response.status_code, body)


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
        from x402.httpx import create_payment_headers  # type: ignore[import-untyped]
    except ImportError:
        return None

    try:
        return create_payment_headers(response)
    except Exception:
        return None


# ── Sync client ──────────────────────────────────────────────────────────────


class _SyncHTTPClient:
    def __init__(
        self,
        private_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        pool_max_connections: int = DEFAULT_POOL_MAX_CONNECTIONS,
        pool_max_keepalive: int = DEFAULT_POOL_MAX_KEEPALIVE_CONNECTIONS,
    ) -> None:
        self._account = Account.from_key(private_key)
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
    ) -> Any:
        url = f"{self._base_url}{path}"
        last_exc: BaseException | None = None

        for attempt in range(self._max_retries + 1):
            # Generate fresh auth header each attempt (timestamp-based)
            headers = {"x-wallet-auth": _generate_wallet_auth(self._account)}

            try:
                response = self._http.request(
                    method, url, headers=headers, json=json, params=params
                )
            except (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout) as exc:
                last_exc = exc
                if attempt < self._max_retries:
                    time.sleep(_RETRY_BASE_DELAY * (2**attempt))
                    continue
                raise

            # 402 → attempt x402 payment and retry once
            if response.status_code == 402:
                payment_headers = _try_x402_payment(response)
                if payment_headers:
                    headers.update(payment_headers)
                    response = self._http.request(
                        method, url, headers=headers, json=json, params=params
                    )

            # Retry on transient server errors (429, 500, 502, 503, 504)
            if response.status_code in _RETRYABLE_STATUS_CODES and attempt < self._max_retries:
                retry_after = response.headers.get("retry-after")
                if retry_after and retry_after.isdigit():
                    delay = float(retry_after)
                else:
                    delay = _RETRY_BASE_DELAY * (2**attempt)
                time.sleep(delay)
                continue

            _raise_for_status(response)

            if response.status_code == 204:
                return {}
            return response.json()

        # Should not reach here, but raise last error if we do
        if last_exc is not None:
            raise last_exc
        _raise_for_status(response)  # type: ignore[possibly-undefined]

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
        private_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        pool_max_connections: int = DEFAULT_POOL_MAX_CONNECTIONS,
        pool_max_keepalive: int = DEFAULT_POOL_MAX_KEEPALIVE_CONNECTIONS,
    ) -> None:
        self._account = Account.from_key(private_key)
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
    ) -> Any:
        import asyncio

        url = f"{self._base_url}{path}"
        last_exc: BaseException | None = None

        for attempt in range(self._max_retries + 1):
            headers = {"x-wallet-auth": _generate_wallet_auth(self._account)}

            try:
                response = await self._http.request(
                    method, url, headers=headers, json=json, params=params
                )
            except (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout) as exc:
                last_exc = exc
                if attempt < self._max_retries:
                    await asyncio.sleep(_RETRY_BASE_DELAY * (2**attempt))
                    continue
                raise

            # 402 → attempt x402 payment and retry once
            if response.status_code == 402:
                payment_headers = _try_x402_payment(response)
                if payment_headers:
                    headers.update(payment_headers)
                    response = await self._http.request(
                        method, url, headers=headers, json=json, params=params
                    )

            # Retry on transient server errors (429, 500, 502, 503, 504)
            if response.status_code in _RETRYABLE_STATUS_CODES and attempt < self._max_retries:
                retry_after = response.headers.get("retry-after")
                if retry_after and retry_after.isdigit():
                    delay = float(retry_after)
                else:
                    delay = _RETRY_BASE_DELAY * (2**attempt)
                await asyncio.sleep(delay)
                continue

            _raise_for_status(response)

            if response.status_code == 204:
                return {}
            return response.json()

        if last_exc is not None:
            raise last_exc
        _raise_for_status(response)  # type: ignore[possibly-undefined]

    async def close(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> _AsyncHTTPClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()
