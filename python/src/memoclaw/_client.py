"""Internal HTTP transport with wallet auth, x402 payment fallback, and retry logic."""

from __future__ import annotations

import importlib.util
import json as _json
import logging
import random
import time
from contextlib import contextmanager
from typing import Any, Literal, TypedDict

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
    int_level = _LEVEL_MAP.get(level, level) if isinstance(level, str) else level
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


class PoolHealth(TypedDict):
    """Lightweight snapshot of the underlying httpx connection pool."""

    active_connections: int
    idle_connections: int
    max_connections: int
    max_keepalive_connections: int
    recycle_seconds: float | None


def _is_opentelemetry_available() -> bool:
    """Return True if ``opentelemetry`` can be imported."""
    try:
        return importlib.util.find_spec("opentelemetry") is not None
    except (ImportError, ValueError):
        return False


class _TracingHelper:
    """Lazy OpenTelemetry integration used by HTTP clients."""

    def __init__(self, enabled: bool) -> None:
        self._enabled = enabled
        self._trace_api: Any | None = None
        self._propagator: Any | None = None
        self._span_kind: Any | None = None
        if not enabled:
            return
        try:
            import importlib

            trace_module = importlib.import_module("opentelemetry.trace")
            propagate_module = importlib.import_module("opentelemetry.propagate")
        except Exception:
            self._enabled = False
            return

        tracer = getattr(trace_module, "get_tracer", None)
        propagator_cls = getattr(propagate_module, "TraceContextTextMapPropagator", None)
        span_kind = getattr(trace_module, "SpanKind", None)
        if tracer is None or propagator_cls is None:
            self._enabled = False
            return

        try:
            self._tracer = tracer("memoclaw.sdk")
            self._propagator = propagator_cls()
        except Exception:
            self._enabled = False
            return

        self._trace_api = trace_module
        self._span_kind = getattr(span_kind, "CLIENT", None)

    @contextmanager
    def span(self, name: str, attributes: dict[str, Any]) -> Any:
        if not self._enabled or self._trace_api is None:
            yield None
            return
        start_kwargs: dict[str, Any] = {}
        if self._span_kind is not None:
            start_kwargs["kind"] = self._span_kind
        try:
            manager = self._tracer.start_as_current_span(name, **start_kwargs)
        except Exception:
            yield None
            return
        with manager as span:
            for key, value in attributes.items():
                if value is not None:
                    self._set_attr(span, key, value)
            yield span

    def inject(self, headers: dict[str, str]) -> None:
        if not self._enabled or self._propagator is None:
            return
        try:
            self._propagator.inject(carrier=headers)
        except Exception:
            return

    def record_response(
        self,
        span: Any,
        *,
        status: int,
        duration_ms: int,
        request_id: str | None,
    ) -> None:
        if span is None:
            return
        self._set_attr(span, "memoclaw.status", status)
        self._set_attr(span, "memoclaw.duration_ms", duration_ms)
        if request_id:
            self._set_attr(span, "memoclaw.request_id", request_id)

    def record_exception(self, span: Any, exc: BaseException) -> None:
        if span is None:
            return
        if hasattr(span, "record_exception"):
            try:
                span.record_exception(exc)
            except Exception:
                pass
        self._set_attr(span, "memoclaw.error", exc.__class__.__name__)

    @staticmethod
    def _set_attr(span: Any, key: str, value: Any) -> None:
        if hasattr(span, "set_attribute"):
            try:
                span.set_attribute(key, value)
            except Exception:
                return
        elif hasattr(span, "setAttribute"):
            try:
                span.setAttribute(key, value)  # type: ignore[attr-defined]
            except Exception:
                return


def _sdk_user_agent() -> str:
    """Build User-Agent string with SDK version."""
    try:
        from . import __version__
        return f"memoclaw-sdk-python/{__version__}"
    except Exception:
        return "memoclaw-sdk-python/unknown"

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


def _raise_for_status(response: httpx.Response, *, retry_attempts: int = 0) -> None:
    """Raise a typed :class:`APIError` for non-2xx responses."""
    if response.is_success:
        return
    try:
        body = response.json()
    except Exception:
        body = {"error": {"code": "UNKNOWN", "message": response.text}}
    request_id = response.headers.get("x-request-id")
    raise APIError.from_response(
        response.status_code, body, request_id=request_id, retry_attempts=retry_attempts
    )


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
        pool_recycle_seconds: float | None = None,
        wallet_address: str | None = None,
        enable_tracing: bool = False,
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
        self._user_agent = _sdk_user_agent()
        self._pool_max_connections = pool_max_connections
        self._pool_max_keepalive = pool_max_keepalive
        self._pool_recycle_seconds = pool_recycle_seconds
        
        # Configure connection pool limits for better performance
        limits_kwargs: dict[str, Any] = {
            "max_connections": pool_max_connections,
            "max_keepalive_connections": pool_max_keepalive,
        }
        if pool_recycle_seconds is not None:
            limits_kwargs["keepalive_expiry"] = pool_recycle_seconds
        limits = httpx.Limits(**limits_kwargs)
        self._http = httpx.Client(timeout=timeout, limits=limits)
        self._tracing = _TracingHelper(enable_tracing)

    def pool_health(self) -> PoolHealth:
        """Inspect the current httpx pool stats (best-effort)."""
        transport = getattr(self._http, "_transport", None)
        pool = getattr(transport, "_pool", None) if transport is not None else None
        active = 0
        idle = 0
        if pool is not None:
            connections = list(getattr(pool, "_connections", []))
            for conn in connections:
                try:
                    is_closed = getattr(conn, "is_closed")
                except AttributeError:
                    is_closed = None
                if callable(is_closed):
                    try:
                        if is_closed():
                            continue
                    except Exception:
                        pass
                try:
                    is_idle = getattr(conn, "is_idle")
                except AttributeError:
                    is_idle = None
                if callable(is_idle):
                    try:
                        if is_idle():
                            idle += 1
                            continue
                    except Exception:
                        pass
                active += 1
            max_connections = getattr(pool, "_max_connections", self._pool_max_connections)
            max_keepalive = getattr(pool, "_max_keepalive_connections", self._pool_max_keepalive)
        else:
            max_connections = self._pool_max_connections
            max_keepalive = self._pool_max_keepalive
        return {
            "active_connections": active,
            "idle_connections": idle,
            "max_connections": max_connections,
            "max_keepalive_connections": max_keepalive,
            "recycle_seconds": self._pool_recycle_seconds,
        }

    def warm_up(self, *, path: str = "/v1/free-tier/info", timeout: float | None = None) -> None:
        """Open a connection eagerly so latency spikes don't hit the first user request."""
        effective_timeout = timeout if timeout is not None else min(self._timeout, 5.0)
        try:
            self.request("GET", path, timeout=effective_timeout)
        except Exception as exc:
            raise ConnectionError("MemoClaw connection pool warm-up failed") from exc

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

        with self._tracing.span(
            f"{method} {path}", {"memoclaw.method": method, "memoclaw.path": path}
        ) as span:
            try:
                for attempt in range(self._max_retries + 1):
                    if self._account is not None:
                        headers = {"x-wallet-auth": _generate_wallet_auth(self._account), "user-agent": self._user_agent}
                    else:
                        headers = {"x-wallet-auth": _generate_wallet_only_auth(self._wallet_address), "user-agent": self._user_agent}

                    self._tracing.inject(headers)

                    try:
                        response = self._http.request(
                            method, url, headers=headers, json=json, params=params,
                            timeout=req_timeout,
                        )
                    except (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout) as exc:
                        last_exc = exc
                        if attempt < self._max_retries:
                            delay = _RETRY_BASE_DELAY * (2**attempt)
                            jitter = delay * 0.25 * random.random()
                            logger.debug(
                                "Network error on %s %s, retrying (attempt %d/%d)",
                                method, path, attempt + 1, self._max_retries,
                            )
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

                    if response.status_code == 402:
                        payment_headers = _try_x402_payment(response)
                        if payment_headers:
                            logger.info("x402 payment headers created, retrying %s %s", method, path)
                            headers.update(payment_headers)
                            self._tracing.inject(headers)
                            response = self._http.request(
                                method, url, headers=headers, json=json, params=params,
                                timeout=req_timeout,
                            )
                            x402_duration_ms = round((time.monotonic() - start) * 1000)
                            x402_req_id = response.headers.get("x-request-id", "")
                            logger.debug(
                                "%s %s → %d (%dms, x402 paid)%s",
                                method, path, response.status_code, x402_duration_ms,
                                f" req={x402_req_id}" if x402_req_id else "",
                                extra={
                                    "method": method,
                                    "path": path,
                                    "status": response.status_code,
                                    "duration_ms": x402_duration_ms,
                                    "request_id": x402_req_id or None,
                                },
                            )
                            if response.is_success:
                                self._tracing.record_response(
                                    span,
                                    status=response.status_code,
                                    duration_ms=x402_duration_ms,
                                    request_id=x402_req_id or None,
                                )
                                if response.status_code == 204:
                                    return {}
                                return response.json()

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

                    _raise_for_status(response, retry_attempts=attempt)
                    self._tracing.record_response(
                        span,
                        status=response.status_code,
                        duration_ms=duration_ms,
                        request_id=req_id or None,
                    )

                    if response.status_code == 204:
                        return {}
                    return response.json()
            except Exception as exc:
                self._tracing.record_exception(span, exc)
                raise

        if last_exc is not None:
            raise last_exc
        _raise_for_status(response, retry_attempts=attempt)

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
        pool_recycle_seconds: float | None = None,
        wallet_address: str | None = None,
        enable_tracing: bool = False,
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
        self._user_agent = _sdk_user_agent()
        self._pool_max_connections = pool_max_connections
        self._pool_max_keepalive = pool_max_keepalive
        self._pool_recycle_seconds = pool_recycle_seconds
        
        # Configure connection pool limits for better performance
        limits_kwargs: dict[str, Any] = {
            "max_connections": pool_max_connections,
            "max_keepalive_connections": pool_max_keepalive,
        }
        if pool_recycle_seconds is not None:
            limits_kwargs["keepalive_expiry"] = pool_recycle_seconds
        limits = httpx.Limits(**limits_kwargs)
        self._http = httpx.AsyncClient(timeout=timeout, limits=limits)
        self._tracing = _TracingHelper(enable_tracing)

    def pool_health(self) -> PoolHealth:
        """Inspect async httpx pool stats without awaiting."""
        transport = getattr(self._http, "_transport", None)
        pool = getattr(transport, "_pool", None) if transport is not None else None
        active = 0
        idle = 0
        if pool is not None:
            connections = list(getattr(pool, "_connections", []))
            for conn in connections:
                try:
                    is_closed = getattr(conn, "is_closed")
                except AttributeError:
                    is_closed = None
                if callable(is_closed):
                    try:
                        if is_closed():
                            continue
                    except Exception:
                        pass
                try:
                    is_idle = getattr(conn, "is_idle")
                except AttributeError:
                    is_idle = None
                if callable(is_idle):
                    try:
                        if is_idle():
                            idle += 1
                            continue
                    except Exception:
                        pass
                active += 1
            max_connections = getattr(pool, "_max_connections", self._pool_max_connections)
            max_keepalive = getattr(pool, "_max_keepalive_connections", self._pool_max_keepalive)
        else:
            max_connections = self._pool_max_connections
            max_keepalive = self._pool_max_keepalive
        return {
            "active_connections": active,
            "idle_connections": idle,
            "max_connections": max_connections,
            "max_keepalive_connections": max_keepalive,
            "recycle_seconds": self._pool_recycle_seconds,
        }

    async def warm_up(self, *, path: str = "/v1/free-tier/info", timeout: float | None = None) -> None:
        """Async variant of the eager warm-up helper."""
        effective_timeout = timeout if timeout is not None else min(self._timeout, 5.0)
        try:
            await self.request("GET", path, timeout=effective_timeout)
        except Exception as exc:
            raise ConnectionError("MemoClaw connection pool warm-up failed") from exc

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

        with self._tracing.span(
            f"{method} {path}", {"memoclaw.method": method, "memoclaw.path": path}
        ) as span:
            try:
                for attempt in range(self._max_retries + 1):
                    if self._account is not None:
                        headers = {"x-wallet-auth": _generate_wallet_auth(self._account), "user-agent": self._user_agent}
                    else:
                        headers = {"x-wallet-auth": _generate_wallet_only_auth(self._wallet_address), "user-agent": self._user_agent}

                    self._tracing.inject(headers)

                    try:
                        response = await self._http.request(
                            method, url, headers=headers, json=json, params=params,
                            timeout=req_timeout,
                        )
                    except (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout) as exc:
                        last_exc = exc
                        if attempt < self._max_retries:
                            delay = _RETRY_BASE_DELAY * (2**attempt)
                            jitter = delay * 0.25 * random.random()
                            logger.debug(
                                "Network error on %s %s, retrying (attempt %d/%d)",
                                method, path, attempt + 1, self._max_retries,
                            )
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

                    if response.status_code == 402:
                        payment_headers = _try_x402_payment(response)
                        if payment_headers:
                            logger.info("x402 payment headers created, retrying %s %s", method, path)
                            headers.update(payment_headers)
                            self._tracing.inject(headers)
                            response = await self._http.request(
                                method, url, headers=headers, json=json, params=params,
                                timeout=req_timeout,
                            )
                            x402_duration_ms = round((time.monotonic() - start) * 1000)
                            x402_req_id = response.headers.get("x-request-id", "")
                            logger.debug(
                                "%s %s → %d (%dms, x402 paid)%s",
                                method, path, response.status_code, x402_duration_ms,
                                f" req={x402_req_id}" if x402_req_id else "",
                                extra={
                                    "method": method,
                                    "path": path,
                                    "status": response.status_code,
                                    "duration_ms": x402_duration_ms,
                                    "request_id": x402_req_id or None,
                                },
                            )
                            if response.is_success:
                                self._tracing.record_response(
                                    span,
                                    status=response.status_code,
                                    duration_ms=x402_duration_ms,
                                    request_id=x402_req_id or None,
                                )
                                if response.status_code == 204:
                                    return {}
                                return response.json()

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

                    _raise_for_status(response, retry_attempts=attempt)
                    self._tracing.record_response(
                        span,
                        status=response.status_code,
                        duration_ms=duration_ms,
                        request_id=req_id or None,
                    )

                    if response.status_code == 204:
                        return {}
                    return response.json()
            except Exception as exc:
                self._tracing.record_exception(span, exc)
                raise

        if last_exc is not None:
            raise last_exc
        _raise_for_status(response, retry_attempts=attempt)

    async def close(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> _AsyncHTTPClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()
