"""Event routing + per-device rollup buffering + predictive-alert enrichment.

Phase 2 kept it thin (route + buffer). Phase 5 adds the MaaS call + Socket.IO push
(D9 orchestrator role): eKuiper detects, MaaS predicts, Analytics stitches them
into a [PREDICTIVE ALERT] and pushes to the web app.

Flow per incoming `sensors/events` message:
  1. Emit the raw event over Socket.IO `event` channel (for the live feed + chart).
  2. If event_type == WINDOW_METRICS → append to the device's rollup ring buffer.
  3. Else (event-of-interest: HIGH_CO / SUSTAINED_HIGH_TEMP / HEAT_DRYING / …):
     - if the buffer has LAG_WINDOWS entries → POST /predict → forecast
     - else / on any MaaS failure → forecast_available: false (CEP-only alert)
     - build the enriched alert (§message-contract "Enriched alert"), emit `alert`,
       log a human-readable [PREDICTIVE ALERT] line.
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from typing import Any

from .config import Config
from .contracts import WINDOW_METRICS, Event, ReceivedMeta
from .maas_client import MaasClient
from .metrics import Metrics
from .socketio_server import SioBus

log = logging.getLogger("analytics.events")


class EventProcessor:
    def __init__(
        self,
        cfg: Config,
        metrics: Metrics,
        maas: MaasClient | None = None,
        sio: SioBus | None = None,
    ) -> None:
        self._lag = cfg.lag_windows
        self._metrics = metrics
        self._maas = maas
        self._sio = sio
        self._buffers: dict[str, deque[Event]] = defaultdict(lambda: deque(maxlen=self._lag))

    async def handle(self, event: Event, meta: ReceivedMeta) -> None:
        event_type = event.get("event_type", "UNKNOWN")
        device = event.get("device", "?")
        self._metrics.observe_event(event_type)

        # 1. relay every incoming event to the browser (feed + chart line).
        if self._sio is not None:
            await self._sio.emit_event(event)

        if event_type == WINDOW_METRICS:
            buf = self._buffers[device]
            buf.append(event)
            log.info(
                "[INFO]  WINDOW_METRICS device=%s avg_temp=%.2f buffer=%d/%d",
                device, _f(event.get("avg_temp")), len(buf), self._lag,
            )
            return

        # 2. event-of-interest — enrich with MaaS forecast, emit alert.
        if event_type == "HIGH_CO":
            log.info(
                "[EVENT] HIGH_CO       device=%s co=%.5f temp=%.1f",
                device, _f(event.get("co")), _f(event.get("temp")),
            )
        else:
            extra = {k: v for k, v in event.items() if k not in ("event_type", "device")}
            log.info("[EVENT] %-12s device=%s %s", event_type, device, extra)

        alert = await self._enrich_and_emit(event, meta)
        _log_predictive_alert(alert)

    async def _enrich_and_emit(self, event: Event, meta: ReceivedMeta) -> dict[str, Any]:
        device = str(event.get("device", "?"))
        event_type = str(event.get("event_type", "UNKNOWN"))
        buf = self._buffers.get(device)
        history_ready = buf is not None and len(buf) == self._lag

        forecast: float | None = None
        model_version: str | None = None
        if history_ready and self._maas is not None:
            resp = await self._maas.predict(device, list(buf))
            if resp is not None:
                try:
                    forecast = float(resp["prediction"])
                    model_version = str(resp.get("model_version", "unknown"))
                except (KeyError, TypeError, ValueError):
                    log.warning("MaaS response malformed: %s", resp)

        alert = _build_alert(
            event=event,
            event_type=event_type,
            device=device,
            actual_avg_temp=_maybe_float(event.get("avg_temp")),
            forecast=forecast,
            model_version=model_version,
            history_ready=history_ready,
            decision_time_ms=meta.received_at_ms,
        )
        if self._sio is not None:
            await self._sio.emit_alert(alert)
        return alert

    def buffer_depths(self) -> dict[str, int]:
        return {device: len(buf) for device, buf in self._buffers.items()}


def _build_alert(
    *,
    event: Event,
    event_type: str,
    device: str,
    actual_avg_temp: float | None,
    forecast: float | None,
    model_version: str | None,
    history_ready: bool,
    decision_time_ms: int,
) -> dict[str, Any]:
    forecast_available = forecast is not None
    parts = [f"device={device}", f"eKuiper={event_type}"]
    if actual_avg_temp is not None:
        parts.append(f"(avg {actual_avg_temp:.1f}°C)")
    if forecast_available:
        parts.append(f"| MaaS=next {forecast:.1f}°C")
        parts.append("| pre-emptive")
    elif not history_ready:
        parts.append("| MaaS=unavailable (buffer not full yet)")
    else:
        parts.append("| MaaS=unavailable (prediction unavailable)")

    return {
        "ts": time.time(),
        "device": device,
        "event_type": event_type,
        "actual_avg_temp": actual_avg_temp,
        "forecast_next_avg_temp": forecast,
        "forecast_available": forecast_available,
        "model_version": model_version,
        "message": "[PREDICTIVE ALERT] " + " ".join(parts),
        "window_start": event.get("window_start"),
        "window_end": event.get("window_end"),
        "decision_time_ms": decision_time_ms,
    }


def _log_predictive_alert(alert: dict[str, Any]) -> None:
    log.info("%s", alert["message"])


def _f(value: object) -> float:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return float("nan")


def _maybe_float(value: object) -> float | None:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
