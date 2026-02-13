"""Tests for middleware hooks."""

from __future__ import annotations

import httpx
import pytest
import respx

from memoclaw import MemoClaw

TEST_PRIVATE_KEY = "0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb"
BASE_URL = "https://api.memoclaw.com"


@pytest.fixture
def client():
    c = MemoClaw(private_key=TEST_PRIVATE_KEY, base_url=BASE_URL)
    yield c
    c.close()


class TestBeforeRequestHook:
    @respx.mock
    def test_hook_called_before_request(self, client: MemoClaw):
        calls = []

        def track(method, path, body):
            calls.append((method, path))
            return None

        client.on_before_request(track)

        respx.post(f"{BASE_URL}/v1/store").mock(
            return_value=httpx.Response(
                201,
                json={"id": "m1", "stored": True, "deduplicated": False, "tokens_used": 10},
            )
        )
        client.store("test")
        assert len(calls) == 1
        assert calls[0] == ("POST", "/v1/store")

    @respx.mock
    def test_hook_can_modify_body(self, client: MemoClaw):
        def add_namespace(method, path, body):
            if body:
                body["namespace"] = "injected"
            return body

        client.on_before_request(add_namespace)

        route = respx.post(f"{BASE_URL}/v1/store").mock(
            return_value=httpx.Response(
                201,
                json={"id": "m1", "stored": True, "deduplicated": False, "tokens_used": 10},
            )
        )
        client.store("test")
        assert b"injected" in route.calls[0].request.content


class TestAfterResponseHook:
    @respx.mock
    def test_hook_called_after_response(self, client: MemoClaw):
        results = []

        def track(method, path, data):
            results.append(data)
            return None

        client.on_after_response(track)

        respx.get(f"{BASE_URL}/v1/free-tier/status").mock(
            return_value=httpx.Response(
                200,
                json={"wallet": "0x", "free_tier_remaining": 100, "free_tier_total": 1000, "free_tier_used": 900},
            )
        )
        client.status()
        assert len(results) == 1
        assert results[0]["free_tier_remaining"] == 100


class TestOnErrorHook:
    @respx.mock
    def test_hook_called_on_error(self, client: MemoClaw):
        errors = []

        def track(method, path, exc):
            errors.append((method, path, exc))

        client.on_error(track)

        respx.post(f"{BASE_URL}/v1/store").mock(
            return_value=httpx.Response(
                404,
                json={"error": {"code": "NOT_FOUND", "message": "Not found"}},
            )
        )
        with pytest.raises(Exception):
            client.store("test")
        assert len(errors) == 1
        assert errors[0][0] == "POST"


class TestHookChaining:
    def test_fluent_chaining(self):
        c = MemoClaw(private_key=TEST_PRIVATE_KEY)
        result = (
            c.on_before_request(lambda m, p, b: None)
            .on_after_response(lambda m, p, d: None)
            .on_error(lambda m, p, e: None)
        )
        assert result is c
        c.close()
