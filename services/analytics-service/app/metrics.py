"""Running metrics for /stats and the dual-latency report (Scenario D)."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass(slots=True)
class WindowSummary:
    start_iso: str
    end_iso: str
    count: int
    avg_temp: float
    avg_humidity: float
    avg_co: float
    alert: bool
    event_to_alert_avg_ms: float
    event_to_alert_max_ms: float


@dataclass
class Metrics:
    messages: int = 0
    # transport latency (per message): received_at_ms - sent_at_ms
    transport_count: int = 0
    transport_sum_ms: float = 0.0
    transport_max_ms: float = 0.0
    # windows / alerts
    windows: int = 0
    alerts: int = 0
    # event-to-alert latency (per non-empty window, message-averaged)
    e2a_count: int = 0
    e2a_sum_ms: float = 0.0
    e2a_max_ms: float = 0.0
    last_window: WindowSummary | None = field(default=None)

    def observe_transport(self, latency_ms: float) -> None:
        self.messages += 1
        self.transport_count += 1
        self.transport_sum_ms += latency_ms
        if latency_ms > self.transport_max_ms:
            self.transport_max_ms = latency_ms

    def observe_window(self, summary: WindowSummary) -> None:
        self.windows += 1
        if summary.alert:
            self.alerts += 1
        if summary.count > 0:
            self.e2a_count += 1
            self.e2a_sum_ms += summary.event_to_alert_avg_ms
            if summary.event_to_alert_max_ms > self.e2a_max_ms:
                self.e2a_max_ms = summary.event_to_alert_max_ms
        self.last_window = summary

    def snapshot(self) -> dict:
        return {
            "messages": self.messages,
            "windows": self.windows,
            "alerts": self.alerts,
            "transportLatencyMs": {
                "count": self.transport_count,
                "avg": round(self.transport_sum_ms / self.transport_count, 2) if self.transport_count else 0,
                "max": round(self.transport_max_ms, 2),
            },
            "eventToAlertLatencyMs": {
                "windows": self.e2a_count,
                "avg": round(self.e2a_sum_ms / self.e2a_count, 2) if self.e2a_count else 0,
                "max": round(self.e2a_max_ms, 2),
            },
            "lastWindow": asdict(self.last_window) if self.last_window else None,
        }
