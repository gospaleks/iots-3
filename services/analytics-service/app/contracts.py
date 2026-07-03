"""Message contract — the Python mirror of @iots/contracts.

Different language, same written contract (shared/message-contract.md): this is
necessary parity, not duplication. JSON only.
"""
from __future__ import annotations

from dataclasses import dataclass

# Topic (overridable via TOPIC env var).
MQTT_TOPIC = "sensors/telemetry"


@dataclass(slots=True)
class SensorMessage:
    """Broker payload. `ts` is dataset event time (epoch s); `sent_at_ms` is the
    publisher's send time (epoch ms) and is the basis for latency — never conflate them."""

    ts: float
    device: str
    co: float
    humidity: float
    light: bool
    lpg: float
    motion: bool
    smoke: float
    temp: float
    seq: int
    sent_at_ms: int

    @classmethod
    def from_dict(cls, d: dict) -> "SensorMessage":
        return cls(
            ts=d["ts"],
            device=d["device"],
            co=d["co"],
            humidity=d["humidity"],
            light=d["light"],
            lpg=d["lpg"],
            motion=d["motion"],
            smoke=d["smoke"],
            temp=d["temp"],
            seq=d["seq"],
            sent_at_ms=d["sent_at_ms"],
        )


@dataclass(slots=True)
class ReceivedMeta:
    """Captured at receive time — `received_at_ms` feeds transport latency."""

    topic: str
    received_at_ms: int
