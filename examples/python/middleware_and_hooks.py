"""Using middleware hooks for logging, metrics, and request modification."""

import time
from memoclaw import MemoClaw


def log_requests(method: str, path: str, body: dict | None) -> dict | None:
    """Log every outgoing request."""
    print(f"→ {method} {path}")
    return None  # Don't modify the body


def track_latency(method: str, path: str, result):
    """Track response times (simplified — use a real metrics library in production)."""
    print(f"← {method} {path} OK")
    return None


def handle_errors(method: str, path: str, error: Exception):
    """Custom error handling — e.g., send to Sentry."""
    print(f"✗ {method} {path} failed: {error}")


# Chain hooks fluently
client = (
    MemoClaw()
    .on_before_request(log_requests)
    .on_after_response(track_latency)
    .on_error(handle_errors)
)

# Add default namespace via before_request hook
def add_default_namespace(method: str, path: str, body: dict | None) -> dict | None:
    if body and "namespace" not in body:
        body["namespace"] = "my-app"
    return body

client.on_before_request(add_default_namespace)

# All requests now go through hooks
result = client.store("Test memory with hooks", importance=0.5)
print(f"Stored: {result.id}")

client.close()
