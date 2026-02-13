"""Internal HTTP transport with wallet auth and x402 payment fallback."""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct

from .errors import APIError, PaymentRequiredError

DEFAULT_BASE_URL = "https://api.memoclaw.com"
DEFAULT_TIMEOUT = 30.0
DEFAULT_MAX_RETRIES = 1
_RETRY_BASE_DELAY = 0.5  # seconds
_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}

logger = logging.getLogger("memoclaw")


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
    ) -> None:
        self._account = Account.from_key(private_key)
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._max_retries = max_retries
        self._http = httpx.Client(timeout=timeout)

    def request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        url = f"{self._base_url}{path}"
        last_error: Exception | None = None

        for attempt in range(self._max_retries + 1):
            headers = {"x-wallet-auth": _generate_wallet_auth(self._account)}

            try:
                response = self._http.request(
                    method, url, headers=headers, json=json, params=params
                )
            except httpx.TransportError as exc:
                last_error = exc
                if attempt < self._max_retries:
                    delay = _RETRY_BASE_DELAY * (2 ** attempt)
                    logger.debug("Request failed (attempt %d/%d), retrying in %.1fs: %s", attempt + 1, self._max_retries + 1, delay, exc)
                    time.sleep(delay)
                    continue
                raise APIError.from_response(0, {"error": {"code": "TRANSPORT_ERROR", "message": str(exc)}})

            # 402 → attempt x402 payment and retry once
            if response.status_code == 402:
                payment_headers = _try_x402_payment(response)
                if payment_headers:
                    headers.update(payment_headers)
                    response = self._http.request(
                        method, url, headers=headers, json=json, params=params
                    )

            # Retry on transient server errors
            if response.status_code in _RETRYABLE_STATUS_CODES and attempt < self._max_retries:
                delay = _RETRY_BASE_DELAY * (2 ** attempt)
                logger.debug("HTTP %d (attempt %d/%d), retrying in %.1fs", response.status_code, attempt + 1, self._max_retries + 1, delay)
                time.sleep(delay)
                continue

            _raise_for_status(response)

            if response.status_code == 204:
                return {}
            return response.json()

        # Should not reach here, but just in case
        raise last_error or APIError.from_response(0, {"error": {"code": "MAX_RETRIES", "message": "Max retries exceeded"}})

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
    ) -> None:
        self._account = Account.from_key(private_key)
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._max_retries = max_retries
        self._http = httpx.AsyncClient(timeout=timeout)

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
        last_error: Exception | None = None

        for attempt in range(self._max_retries + 1):
            headers = {"x-wallet-auth": _generate_wallet_auth(self._account)}

            try:
                response = await self._http.request(
                    method, url, headers=headers, json=json, params=params
                )
            except httpx.TransportError as exc:
                last_error = exc
                if attempt < self._max_retries:
                    delay = _RETRY_BASE_DELAY * (2 ** attempt)
                    logger.debug("Request failed (attempt %d/%d), retrying in %.1fs: %s", attempt + 1, self._max_retries + 1, delay, exc)
                    await asyncio.sleep(delay)
                    continue
                raise APIError.from_response(0, {"error": {"code": "TRANSPORT_ERROR", "message": str(exc)}})

            if response.status_code == 402:
                payment_headers = _try_x402_payment(response)
                if payment_headers:
                    headers.update(payment_headers)
                    response = await self._http.request(
                        method, url, headers=headers, json=json, params=params
                    )

            if response.status_code in _RETRYABLE_STATUS_CODES and attempt < self._max_retries:
                delay = _RETRY_BASE_DELAY * (2 ** attempt)
                logger.debug("HTTP %d (attempt %d/%d), retrying in %.1fs", response.status_code, attempt + 1, self._max_retries + 1, delay)
                await asyncio.sleep(delay)
                continue

            _raise_for_status(response)

            if response.status_code == 204:
                return {}
            return response.json()

        raise last_error or APIError.from_response(0, {"error": {"code": "MAX_RETRIES", "message": "Max retries exceeded"}})

    async def close(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> _AsyncHTTPClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()
