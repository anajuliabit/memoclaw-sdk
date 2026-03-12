"""Tests for free_tier_info() and create_session()."""

from __future__ import annotations

import os
from unittest.mock import patch

import httpx
import pytest
import respx

from memoclaw import (
    AsyncMemoClaw,
    FreeTierInfo,
    MemoClaw,
    SessionAuthResponse,
)

TEST_PRIVATE_KEY = "0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb"
TEST_WALLET = "0x2c7536E3605D9C16a7a3D7b1898e529396a65c23"
BASE_URL = "https://api.memoclaw.com"

FREE_TIER_INFO_RESPONSE = {
    "free_tier": {
        "enabled": True,
        "calls_per_wallet": 100,
        "description": "Every wallet gets 100 free API calls. No payment required.",
    },
    "auth": {
        "header": "x-wallet-auth",
        "format": "{wallet_address}:{unix_timestamp}:{signature}",
        "message_to_sign": "memoclaw-auth:{unix_timestamp}",
        "expiry_seconds": 300,
    },
    "after_free_tier": {
        "payment": "x402 (USDC on Base)",
        "note": "Only endpoints using OpenAI are charged. See /reference/pricing for details.",
    },
}

SESSION_RESPONSE = {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test",
    "wallet": TEST_WALLET,
    "expires_at": "2026-03-19T14:00:00Z",
}


@pytest.fixture
def client():
    c = MemoClaw(private_key=TEST_PRIVATE_KEY, base_url=BASE_URL)
    yield c
    c.close()


@pytest.fixture
def wallet_client():
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("MEMOCLAW_PRIVATE_KEY", None)
        c = MemoClaw(wallet_address=TEST_WALLET, base_url=BASE_URL)
        yield c
        c.close()


@pytest.fixture
def async_client():
    return AsyncMemoClaw(private_key=TEST_PRIVATE_KEY, base_url=BASE_URL)


@pytest.fixture
def async_wallet_client():
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("MEMOCLAW_PRIVATE_KEY", None)
        c = AsyncMemoClaw(wallet_address=TEST_WALLET, base_url=BASE_URL)
        yield c


# ── Sync free_tier_info ─────────────────────────────────────────


class TestSyncFreeTierInfo:
    @respx.mock
    def test_returns_policy_info(self, client: MemoClaw):
        respx.get(f"{BASE_URL}/v1/free-tier/info").mock(
            return_value=httpx.Response(200, json=FREE_TIER_INFO_RESPONSE)
        )
        info = client.free_tier_info()
        assert isinstance(info, FreeTierInfo)
        assert info.free_tier.enabled is True
        assert info.free_tier.calls_per_wallet == 100
        assert info.auth.header == "x-wallet-auth"
        assert "x402" in info.after_free_tier.payment

    @respx.mock
    def test_works_with_wallet_only(self, wallet_client: MemoClaw):
        respx.get(f"{BASE_URL}/v1/free-tier/info").mock(
            return_value=httpx.Response(200, json=FREE_TIER_INFO_RESPONSE)
        )
        info = wallet_client.free_tier_info()
        assert info.free_tier.enabled is True


# ── Sync create_session ─────────────────────────────────────────


class TestSyncCreateSession:
    @respx.mock
    def test_returns_session_token(self, client: MemoClaw):
        route = respx.post(f"{BASE_URL}/auth/session").mock(
            return_value=httpx.Response(200, json=SESSION_RESPONSE)
        )
        session = client.create_session()
        assert isinstance(session, SessionAuthResponse)
        assert session.token == SESSION_RESPONSE["token"]
        assert session.wallet == TEST_WALLET
        assert session.expires_at == "2026-03-19T14:00:00Z"

        # Verify the request body
        assert route.called
        request = route.calls[0].request
        import json

        body = json.loads(request.content)
        assert "address" in body
        assert "timestamp" in body
        assert "signature" in body
        assert isinstance(body["timestamp"], int)

    def test_raises_without_private_key(self, wallet_client: MemoClaw):
        with pytest.raises(Exception, match="(?i)sign|private"):
            wallet_client.create_session()


# ── Async free_tier_info ────────────────────────────────────────


class TestAsyncFreeTierInfo:
    @respx.mock
    @pytest.mark.anyio
    async def test_returns_policy_info(self, async_client: AsyncMemoClaw):
        respx.get(f"{BASE_URL}/v1/free-tier/info").mock(
            return_value=httpx.Response(200, json=FREE_TIER_INFO_RESPONSE)
        )
        info = await async_client.free_tier_info()
        assert isinstance(info, FreeTierInfo)
        assert info.free_tier.enabled is True
        assert info.free_tier.calls_per_wallet == 100


# ── Async create_session ────────────────────────────────────────


class TestAsyncCreateSession:
    @respx.mock
    @pytest.mark.anyio
    async def test_returns_session_token(self, async_client: AsyncMemoClaw):
        respx.post(f"{BASE_URL}/auth/session").mock(
            return_value=httpx.Response(200, json=SESSION_RESPONSE)
        )
        session = await async_client.create_session()
        assert isinstance(session, SessionAuthResponse)
        assert session.token == SESSION_RESPONSE["token"]

    @pytest.mark.anyio
    async def test_raises_without_private_key(self, async_wallet_client: AsyncMemoClaw):
        with pytest.raises(Exception, match="(?i)sign|private"):
            await async_wallet_client.create_session()
