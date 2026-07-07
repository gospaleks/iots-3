"""Event routing + per-device rollup buffering (the Project 2 window's replacement).

eKuiper owns windowing (D9); Analytics stays thin (D4). This module:
  - routes each `sensors/events` message by `event_type`,
  - keeps a per-device ring buffer of the last `LAG_WINDOWS` WINDOW_METRICS rollups
    (the raw aggregate dicts, forwarded to MaaS verbatim in Phase 5 — no feature
    engineering here),
  - logs events distinctly and exposes buffer depths for /stats.

No ML yet — Phase 5 adds the MaaS call + enriched alerts.
"""
from __future__ import annotations

import logging
from collections import defaultdict, deque

from .config import Config
from .contracts import WINDOW_METRICS, Event, ReceivedMeta
from .metrics import Metrics

log = logging.getLogger("analytics.events")


class EventProcessor:
    def __init__(self, cfg: Config, metrics: Metrics) -> None:
        self._lag = cfg.lag_windows
        self._metrics = metrics
        # device -> last N rollup aggregates (oldest → newest).
        self._buffers: dict[str, deque[Event]] = defaultdict(lambda: deque(maxlen=self._lag))

    def handle(self, event: Event, meta: ReceivedMeta) -> None:
        event_type = event.get("event_type", "UNKNOWN")
        device = event.get("device", "?")
        self._metrics.observe_event(event_type)

        if event_type == WINDOW_METRICS:
            buf = self._buffers[device]
            buf.append(event)
            log.info(
                "[INFO]  WINDOW_METRICS device=%s avg_temp=%.2f buffer=%d/%d",
                device, _f(event.get("avg_temp")), len(buf), self._lag,
            )
        elif event_type == "HIGH_CO":
            log.info(
                "[EVENT] HIGH_CO       device=%s co=%.5f temp=%.1f",
                device, _f(event.get("co")), _f(event.get("temp")),
            )
        else:
            # Event-of-interest types added in Phase 6 (SUSTAINED_HIGH_TEMP, HEAT_DRYING, …).
            extra = {k: v for k, v in event.items() if k not in ("event_type", "device")}
            log.info("[EVENT] %-12s device=%s %s", event_type, device, extra)

    def buffer_depths(self) -> dict[str, int]:
        """Per-device rollup buffer depth (for /stats)."""
        return {device: len(buf) for device, buf in self._buffers.items()}


def _f(value: object) -> float:
    """Coerce a possibly-missing numeric field to float for logging."""
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return float("nan")
