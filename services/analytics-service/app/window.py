"""Tumbling window (fixed, non-overlapping) — REQUIREMENTS §5.3.

Every WINDOW_SIZE_SEC the current window closes: compute avg temp/humidity/co over
messages received in the window, log an [ALERT]/[INFO] summary, record both latencies,
and reset the accumulator. Window boundaries are by receive (wall-clock) time.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone

from .config import Config
from .contracts import ReceivedMeta, SensorMessage
from .metrics import Metrics, WindowSummary

# Dedicated logger that prints the spec-formatted lines verbatim to stdout.
summary_log = logging.getLogger("analytics.window")


class TumblingWindow:
    def __init__(self, cfg: Config, metrics: Metrics) -> None:
        self._cfg = cfg
        self._metrics = metrics
        self._running = True
        self._reset(time.time())

    def _reset(self, start_ts: float) -> None:
        self._start_ts = start_ts
        self._count = 0
        self._sum_temp = 0.0
        self._sum_hum = 0.0
        self._sum_co = 0.0
        self._sum_sent = 0  # sum of sent_at_ms
        self._min_sent: int | None = None

    def add(self, msg: SensorMessage, _meta: ReceivedMeta) -> None:
        self._count += 1
        self._sum_temp += msg.temp
        self._sum_hum += msg.humidity
        self._sum_co += msg.co
        self._sum_sent += msg.sent_at_ms
        if self._min_sent is None or msg.sent_at_ms < self._min_sent:
            self._min_sent = msg.sent_at_ms

    async def run(self) -> None:
        """Close a window every WINDOW_SIZE_SEC until cancelled."""
        try:
            while self._running:
                await asyncio.sleep(self._cfg.window_size_sec)
                self._close()
        except asyncio.CancelledError:
            self._close()  # flush the final partial window on shutdown
            raise

    def _close(self) -> None:
        # Snapshot + reset atomically (no await between → safe in the single event loop).
        start_ts, end_ts = self._start_ts, time.time()
        count = self._count
        sum_temp, sum_hum, sum_co = self._sum_temp, self._sum_hum, self._sum_co
        sum_sent, min_sent = self._sum_sent, self._min_sent
        self._reset(end_ts)

        start_iso = _iso(start_ts)
        end_iso = _iso(end_ts)
        if count == 0:
            print(f"[INFO]  {_iso(end_ts)} | Window [{start_iso}–{end_iso}] | no messages | OK", flush=True)
            self._metrics.observe_window(
                WindowSummary(start_iso, end_iso, 0, 0.0, 0.0, 0.0, False, 0.0, 0.0)
            )
            return

        avg_temp = sum_temp / count
        avg_hum = sum_hum / count
        avg_co = sum_co / count
        alert = avg_temp > self._cfg.alert_threshold

        # Event-to-alert latency: alert_log time minus each message's send time.
        alert_log_ms = end_ts * 1000.0
        e2a_avg = alert_log_ms - (sum_sent / count)
        e2a_max = alert_log_ms - min_sent if min_sent is not None else 0.0

        level = "ALERT" if alert else "INFO "
        verdict = "THRESHOLD EXCEEDED" if alert else "OK"
        print(
            f"[{level}] {_iso(end_ts)} | Window [{start_iso}–{end_iso}] | "
            f"AvgTemp: {avg_temp:.2f}°F | AvgHumidity: {avg_hum:.2f}% | AvgCO: {avg_co:.5f}ppm | {verdict}",
            flush=True,
        )
        # Parseable latency line.
        print(
            f"[LATENCY] window_end={end_iso} msgs={count} "
            f"event_to_alert_ms_avg={e2a_avg:.1f} event_to_alert_ms_max={e2a_max:.1f}",
            flush=True,
        )

        self._metrics.observe_window(
            WindowSummary(start_iso, end_iso, count, round(avg_temp, 2), round(avg_hum, 2),
                          round(avg_co, 5), alert, round(e2a_avg, 1), round(e2a_max, 1))
        )

    def stop(self) -> None:
        self._running = False


def _iso(epoch_s: float) -> str:
    return datetime.fromtimestamp(epoch_s, tz=timezone.utc).isoformat(timespec="milliseconds")
