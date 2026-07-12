"""Async MaaS REST client — the sole place Analytics talks to MaaS.

Phase 5: on every event-of-interest, Analytics POSTs the buffered rollup history to
MaaS `/predict` with a hard timeout. Any failure (timeout, connection, HTTP error,
malformed body) returns None and Analytics falls back to a CEP-only alert — the
subscribe loop must NEVER stall on a slow MaaS.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

log = logging.getLogger("analytics.maas")

# Fields forwarded to MaaS (must match maas/features.py HistoryWindow schema).
_PREDICT_FIELDS = ("avg_temp", "avg_humidity", "avg_co", "max_temp")


class MaasClient:
    def __init__(self, base_url: str, timeout_ms: int) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_s = timeout_ms / 1000.0
        self._client = httpx.AsyncClient(base_url=self._base_url, timeout=self._timeout_s)

    async def close(self) -> None:
        await self._client.aclose()

    async def predict(self, device: str, history: list[dict]) -> dict[str, Any] | None:
        """POST /predict. Return response dict or None on any failure."""
        payload = {
            "device": device,
            "history": [
                {k: float(h.get(k, 0.0)) for k in _PREDICT_FIELDS} for h in history
            ],
        }
        try:
            resp = await self._client.post("/predict", json=payload)
            resp.raise_for_status()
            return resp.json()
        except httpx.TimeoutException:
            log.warning("MaaS /predict timeout after %.0fms (device=%s)", self._timeout_s * 1000, device)
        except httpx.HTTPStatusError as e:
            log.warning("MaaS /predict %s (device=%s): %s", e.response.status_code, device, e.response.text[:200])
        except httpx.HTTPError as e:
            log.warning("MaaS /predict transport error (device=%s): %s", device, e)
        except Exception as e:  # noqa: BLE001 — defensive: never let subscribe loop die
            log.warning("MaaS /predict unexpected error (device=%s): %s", device, e)
        return None
