"""Message contract — the Python mirror of the `sensors/events` payload.

Project 3: Analytics no longer parses raw telemetry; it consumes eKuiper's tagged
window events off `sensors/events` (see shared/message-contract.md §"Downstream
contracts"). Each message is a single JSON object discriminated by `event_type`.
Analytics stays thin (D4): it forwards raw aggregate dicts, so events are kept as
plain dicts rather than a rigid dataclass — the field set differs per event_type
and grows in Phase 6.
"""
from __future__ import annotations

from dataclasses import dataclass

# eKuiper sink topic (overridable via EVENTS_TOPIC env var).
EVENTS_TOPIC = "sensors/events"

# event_type discriminator values (see shared/message-contract.md).
WINDOW_METRICS = "WINDOW_METRICS"   # continuous rollup — feeds the forecast buffer + chart
# Event-of-interest types. Routing in events.py is generic — anything that is not
# WINDOW_METRICS gets enriched — so these exist for documentation + log formatting.
HIGH_CO = "HIGH_CO"                            # per-message threshold (Phase 1)
SUSTAINED_HIGH_TEMP = "SUSTAINED_HIGH_TEMP"    # windowed HAVING AVG(temp) (Phase 6)
HEAT_DRYING = "HEAT_DRYING"                    # multi-condition correlation (Phase 6)

# Aggregate fields carried by every WINDOW_METRICS event (and the interest events
# that reuse the rollup shape). Buffered verbatim and forwarded to MaaS in Phase 5.
ROLLUP_FIELDS = (
    "avg_temp", "max_temp", "min_temp",
    "avg_humidity", "avg_co", "avg_lpg", "avg_smoke",
    "sample_count", "window_start", "window_end",
)

# A parsed event is just its JSON object.
Event = dict


@dataclass(slots=True)
class ReceivedMeta:
    """Captured at receive time. `sensors/events` carries no `sent_at_ms`, so
    `received_at_ms` is Analytics' own decision-time stamp (basis for a Phase-5
    event-to-alert latency)."""

    topic: str
    received_at_ms: int
