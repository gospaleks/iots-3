"""Socket.IO server module — the browser transport for the web app (D11).

The web app connects to Analytics (Socket.IO for live data + REST for snapshots) —
it never speaks MQTT. Two channels are emitted:
  - `event` : every incoming `sensors/events` message, relayed as-is (incl. WINDOW_METRICS
              so the app can draw the actual-temp line).
  - `alert` : the enriched predictive-alert payload from EventProcessor
              (§message-contract "Enriched alert").

Also holds in-memory ring buffers of recent events / alerts / per-device forecast history
so `/api/*` snapshot endpoints can seed the app before Socket.IO catches up.
"""
from __future__ import annotations

import logging
from collections import defaultdict, deque
from typing import Any

import socketio

log = logging.getLogger("analytics.sio")


class SioBus:
    """Socket.IO server + in-memory ring buffers for REST snapshots."""

    def __init__(self, cors_origins: str, ring_size: int = 200) -> None:
        origins = self._parse_origins(cors_origins)
        self.sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=origins)
        self._ring_size = ring_size
        self._events: deque[dict[str, Any]] = deque(maxlen=ring_size)
        self._alerts: deque[dict[str, Any]] = deque(maxlen=ring_size)
        # per-device history of (window_end_ms, actual_avg_temp, forecast_next_avg_temp)
        self._forecast: dict[str, deque[dict[str, Any]]] = defaultdict(
            lambda: deque(maxlen=ring_size)
        )

        @self.sio.event
        async def connect(sid: str, environ: dict) -> None:  # noqa: ARG001
            log.info("sio client connected sid=%s", sid)

        @self.sio.event
        async def disconnect(sid: str) -> None:
            log.info("sio client disconnected sid=%s", sid)

    @staticmethod
    def _parse_origins(spec: str) -> str | list[str]:
        spec = (spec or "").strip()
        if not spec or spec == "*":
            return "*"
        return [o.strip() for o in spec.split(",") if o.strip()]

    async def emit_event(self, event: dict[str, Any]) -> None:
        self._events.append(event)
        await self.sio.emit("event", event)

    async def emit_alert(self, alert: dict[str, Any]) -> None:
        self._alerts.append(alert)
        device = alert.get("device")
        if device:
            self._forecast[device].append({
                "ts": alert.get("ts"),
                "actual_avg_temp": alert.get("actual_avg_temp"),
                "forecast_next_avg_temp": alert.get("forecast_next_avg_temp"),
                "forecast_available": alert.get("forecast_available"),
                "event_type": alert.get("event_type"),
            })
        await self.sio.emit("alert", alert)

    def snapshot_events(self, limit: int) -> list[dict[str, Any]]:
        return list(self._events)[-limit:]

    def snapshot_alerts(self, limit: int) -> list[dict[str, Any]]:
        return list(self._alerts)[-limit:]

    def snapshot_forecast(self, device: str, limit: int) -> list[dict[str, Any]]:
        return list(self._forecast.get(device, []))[-limit:]

    def stats(self) -> dict[str, Any]:
        return {
            "sioEventsBuffered": len(self._events),
            "sioAlertsBuffered": len(self._alerts),
            "forecastHistoryDevices": len(self._forecast),
        }
