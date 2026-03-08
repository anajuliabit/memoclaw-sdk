"""Tests for ping() / health check."""

from __future__ import annotations

import os
from unittest.mock import patch

import httpx
import pytest
import respx

from memoclaw import AsyncMemoClaw, MemoClaw, PingResult

TEST_PRIVATE_KEY = "0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb"
TEST_WALLET = "0x2c7536E3605D9C16a7a3D7b1898e529396a65c23"
BASE_URL = "https://api.memoclaw.com"

FREE_TIER_RESPONSE = {
    "wallet": TEST_WALLET,
    "free_tier_remaining": 87,
    "free_tier_total": 100,
    "free_tier_used": 13,
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


class TestSyncPing:
    @respx.mock
    def test_ping_success(self, client: MemoClaw):
        respx.get(f"{BASE_URL}/v1/free-tier/status").mock(
            return_value=httpx.Response(200, json=FREE_TIER_RESPONSE)
        )
        result = client.ping()
        assert isinstance(result, PingResult)
        assert result.ok is True
        assert result.auth == "signed"
        assert result.free_tier_remaining == 87
        assert result.latency_ms >= 0

    @respx.mock
    def test_ping_wallet_only(self, wallet_client: MemoClaw):
        respx.get(f"{BASE_URL}/v1/free-tier/status").mock(
            return_value=httpx.Response(200, json=FREE_TIER_RESPONSE)
        )
        result = wallet_client.ping()
        assert result.ok is True
        assert result.auth == "wallet-only"
        assert result.free_tier_remaining == 87

    @respx.mock
    def test_ping_failure(self, client: MemoClaw):
        respx.get(f"{BASE_URL}/v1/free-tier/status").mock(
            return_value=httpx.Response(500, json={"error": {"code": "INTERNAL", "message": "boom"}})
        )
        result = client.ping()
        assert result.ok is False
        assert result.auth == "signed"
        assert result.free_tier_remaining == 0
        assert result.latency_ms >= 0

    @respx.mock
    def test_ping_network_error(self, client: MemoClaw):
        respx.get(f"{BASE_URL}/v1/free-tier/status").mock(side_effect=httpx.ConnectError("nope"))
        result = client.ping()
        assert result.ok is False
        assert result.latency_ms >= 0


class TestAsyncPing:
    @respx.mock
    @pytest.mark.anyio
    async def test_ping_success(self, async_client: AsyncMemoClaw):
        respx.get(f"{BASE_URL}/v1/free-tier/status").mock(
            return_value=httpx.Response(200, json=FREE_TIER_RESPONSE)
        )
        result = await async_client.ping()
        assert isinstance(result, PingResult)
        assert result.ok is True
        assert result.auth == "signed"
        assert result.free_tier_remaining == 87

    @respx.mock
    @pytest.mark.anyio
    async def test_ping_wallet_only(self, async_wallet_client: AsyncMemoClaw):
        respx.get(f"{BASE_URL}/v1/free-tier/status").mock(
            return_value=httpx.Response(200, json=FREE_TIER_RESPONSE)
        )
        result = await async_wallet_client.ping()
        assert result.ok is True
        assert result.auth == "wallet-only"

    @respx.mock
    @pytest.mark.anyio
    async def test_ping_failure(self, async_client: AsyncMemoClaw):
        respx.get(f"{BASE_URL}/v1/free-tier/status").mock(
            return_value=httpx.Response(500, json={"error": {"code": "INTERNAL", "message": "boom"}})
        )
        result = await async_client.ping()
        assert result.ok is False
        assert result.free_tier_remaining == 0


class TestValidateOnInit:
    @respx.mock
    def test_validate_on_init_success(self):
        respx.get(f"{BASE_URL}/v1/free-tier/status").mock(
            return_value=httpx.Response(200, json=FREE_TIER_RESPONSE)
        )
        client = MemoClaw(
            private_key=TEST_PRIVATE_KEY,
            base_url=BASE_URL,
            validate_on_init=True,
        )
        client.close()

    @respx.mock
    def test_validate_on_init_failure(self):
        respx.get(f"{BASE_URL}/v1/free-tier/status").mock(
            side_effect=httpx.ConnectError("nope")
        )
        with pytest.raises(ConnectionError, match="health check failed"):
            MemoClaw(
                private_key=TEST_PRIVATE_KEY,
                base_url=BASE_URL,
                validate_on_init=True,
            )
