"""Internal HTTP transport with wallet auth and x402 payment fallback."""

from __future__ import annotations

import time
from typing import Any

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct

from .errors import APIError, PaymentRequiredError

DEFAULT_BASE_URL = "https://api.memoclaw.com"
DEFAULT_TIMEOUT = 30.0
DEFAULT_MAX_RETRIES = 1


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
        headers = {"x-wallet-auth": _generate_wallet_auth(self._account)}

        response = self._http.request(
            method, url, headers=headers, json=json, params=params
        )

        # 402 → attempt x402 payment and retry once
        if response.status_code == 402:
            payment_headers = _try_x402_payment(response)
            if payment_headers:
                headers.update(payment_headers)
                response = self._http.request(
                    method, url, headers=headers, json=json, params=params
                )

        _raise_for_status(response)

        if response.status_code == 204:
            return {}
        return response.json()

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
        url = f"{self._base_url}{path}"
        headers = {"x-wallet-auth": _generate_wallet_auth(self._account)}

        response = await self._http.request(
            method, url, headers=headers, json=json, params=params
        )

        if response.status_code == 402:
            payment_headers = _try_x402_payment(response)
            if payment_headers:
                headers.update(payment_headers)
                response = await self._http.request(
                    method, url, headers=headers, json=json, params=params
                )

        _raise_for_status(response)

        if response.status_code == 204:
            return {}
        return response.json()

    async def close(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> _AsyncHTTPClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()
