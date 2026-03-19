"""Tests for connection pool and retry configuration."""

import pytest
import respx
import httpx
from unittest.mock import patch, MagicMock

from memoclaw import MemoClaw, AsyncMemoClaw


TEST_PRIVATE_KEY = "0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb"
BASE_URL = "https://api.memoclaw.com"


class TestConnectionPool:
    """Test connection pool configuration."""

    def test_default_pool_settings(self):
        """Test default connection pool settings are applied."""
        client = MemoClaw(private_key=TEST_PRIVATE_KEY, base_url=BASE_URL)
        
        # Check that httpx.Client was created - the limits are set internally
        assert client._http._http is not None
        # Verify it's an httpx.Client with proper configuration
        assert isinstance(client._http._http, httpx.Client)
        client.close()

    def test_custom_pool_settings(self):
        """Test custom connection pool settings."""
        client = MemoClaw(
            private_key=TEST_PRIVATE_KEY,
            base_url=BASE_URL,
            pool_max_connections=20,
            pool_max_keepalive=15,
        )
        
        # Verify client is created with custom settings
        assert client._http._http is not None
        assert isinstance(client._http._http, httpx.Client)
        client.close()

    def test_pool_health_snapshot(self, monkeypatch):
        """pool_health should surface idle/active/max counts."""
        class FakeConn:
            def __init__(self, idle: bool, closed: bool = False) -> None:
                self._idle = idle
                self._closed = closed

            def is_idle(self) -> bool:
                return self._idle

            def is_closed(self) -> bool:
                return self._closed

        client = MemoClaw(private_key=TEST_PRIVATE_KEY, base_url=BASE_URL)
        fake_pool = MagicMock()
        fake_pool._connections = [FakeConn(True), FakeConn(False), FakeConn(False, closed=True)]
        fake_pool._max_connections = 12
        fake_pool._max_keepalive_connections = 6

        class FakeTransport:
            def __init__(self) -> None:
                self._pool = fake_pool

            def close(self) -> None:
                pass

        client._http._http._transport = FakeTransport()
        health = client.pool_health()
        assert health["idle_connections"] == 1
        assert health["active_connections"] == 1
        assert health["max_connections"] == 12
        assert health["max_keepalive_connections"] == 6
        client.close()

    def test_warm_pool_option_triggers_helper(self, monkeypatch):
        """warm_pool=True should call the underlying warm_up helper once."""
        calls = {"count": 0}

        def fake_warm_up(self, *, path="/v1/free-tier/info", timeout=None):  # type: ignore[override]
            calls["count"] += 1

        monkeypatch.setattr("memoclaw.client._SyncHTTPClient.warm_up", fake_warm_up, raising=False)
        client = MemoClaw(private_key=TEST_PRIVATE_KEY, base_url=BASE_URL, warm_pool=True)
        assert calls["count"] == 1
        client.close()



class TestAsyncConnectionPool:
    """Test async client connection pool configuration."""

    @pytest.mark.asyncio
    async def test_async_default_pool_settings(self):
        """Test async client uses default pool settings."""
        client = AsyncMemoClaw(
            private_key=TEST_PRIVATE_KEY,
            base_url=BASE_URL,
        )
        
        assert client._http._http is not None
        assert isinstance(client._http._http, httpx.AsyncClient)
        await client.close()

    @pytest.mark.asyncio
    async def test_async_custom_pool_settings(self):
        """Test async client uses custom pool settings."""
        client = AsyncMemoClaw(
            private_key=TEST_PRIVATE_KEY,
            base_url=BASE_URL,
            pool_max_connections=30,
            pool_max_keepalive=20,
        )
        
        assert client._http._http is not None
        assert isinstance(client._http._http, httpx.AsyncClient)
        await client.close()
    @pytest.mark.asyncio
    async def test_async_create_warm_pool_option(self, monkeypatch):
        """Async factory should warm the pool when requested."""
        calls = {"count": 0}

        async def fake_warm_up(self, *, path="/v1/free-tier/info", timeout=None):  # type: ignore[override]
            calls["count"] += 1

        monkeypatch.setattr("memoclaw.client._AsyncHTTPClient.warm_up", fake_warm_up, raising=False)
        client = await AsyncMemoClaw.create(
            private_key=TEST_PRIVATE_KEY,
            base_url=BASE_URL,
            validate_on_init=False,
            warm_pool=True,
        )
        assert calls["count"] == 1
        await client.close()



class TestRetryConfiguration:
    """Test retry configuration."""

    @respx.mock
    def test_default_max_retries(self):
        """Test default max retries is applied."""
        client = MemoClaw(private_key=TEST_PRIVATE_KEY, base_url=BASE_URL)
        
        # Default max_retries should be 2
        assert client._http._max_retries == 2
        client.close()

    @respx.mock
    def test_custom_max_retries(self):
        """Test custom max retries."""
        client = MemoClaw(
            private_key=TEST_PRIVATE_KEY,
            base_url=BASE_URL,
            max_retries=5,
        )
        
        assert client._http._max_retries == 5
        client.close()

    @respx.mock
    def test_max_retries_none_uses_default(self):
        """Test that max_retries=None uses default."""
        client = MemoClaw(
            private_key=TEST_PRIVATE_KEY,
            base_url=BASE_URL,
            max_retries=None,
        )
        
        # Should use DEFAULT_MAX_RETRIES from _client
        assert client._http._max_retries == 2
        client.close()


class TestAsyncRetryConfiguration:
    """Test async retry configuration."""

    @pytest.mark.asyncio
    async def test_async_default_max_retries(self):
        """Test async client uses default max retries."""
        client = AsyncMemoClaw(
            private_key=TEST_PRIVATE_KEY,
            base_url=BASE_URL,
        )
        
        assert client._http._max_retries == 2
        await client.close()

    @pytest.mark.asyncio
    async def test_async_custom_max_retries(self):
        """Test async client uses custom max retries."""
        client = AsyncMemoClaw(
            private_key=TEST_PRIVATE_KEY,
            base_url=BASE_URL,
            max_retries=3,
        )
        
        assert client._http._max_retries == 3
        await client.close()
