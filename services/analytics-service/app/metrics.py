"""Running metrics for /stats.

Project 3: eKuiper owns windowing, so Analytics no longer produces window summaries.
These counters track the event stream it consumes off `sensors/events`.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Metrics:
    events_total: int = 0
    events_by_type: dict[str, int] = field(default_factory=dict)

    def observe_event(self, event_type: str) -> None:
        self.events_total += 1
        self.events_by_type[event_type] = self.events_by_type.get(event_type, 0) + 1

    def snapshot(self) -> dict:
        return {
            "eventsTotal": self.events_total,
            "eventsByType": dict(self.events_by_type),
        }
