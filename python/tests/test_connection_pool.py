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
