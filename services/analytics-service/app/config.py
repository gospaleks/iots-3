"""Environment-driven config (mirrors the per-service env tables in REQUIREMENTS §5.3).

Project 3: Analytics consumes eKuiper output on `sensors/events` (not the raw telemetry
topic) and keeps the last `LAG_WINDOWS` rollups per device. eKuiper owns windowing (D9),
so the Project 2 tumbling-window / alert-threshold knobs are gone.

Phase 5 adds MaaS integration (REST) + Socket.IO to push enriched alerts to the web app.

The WINDOW_* keys are eKuiper's, not ours — Analytics never windows anything (D9). They are
read only to serve them back on `/api/window`: compose feeds Analytics and `ekuiper-provision`
from the same `.env`, so what we report is what provision.sh built the GROUP BY clause from.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass

from .contracts import EVENTS_TOPIC

log = logging.getLogger("analytics.config")


@dataclass(slots=True)
class Config:
    broker_type: str
    host: str
    port: int
    events_topic: str
    qos: int  # MQTT only
    lag_windows: int
    http_port: int
    # Phase 5 — MaaS integration
    maas_url: str
    maas_timeout_ms: int
    # Phase 5 — Socket.IO / web transport
    socketio_cors_origins: str
    ring_buffer_size: int
    # eKuiper window shape — same WINDOW_* keys `ekuiper-provision` builds the
    # GROUP BY clause from, so the web app can show the configured window.
    window_type: str
    window_unit: str
    window_size: int
    window_step: int | None


def _text(env, key: str, default: str) -> str:
    """Read a key that `.env` may ship present-but-blank (e.g. `WINDOW_STEP=`), where
    env.get() returns "" rather than the default.

    Also strips an inline `#` comment: compose's dotenv parser drops those only when the
    key has a value, so `WINDOW_STEP=   # REQUIRED for hopping` arrives as the *comment*.
    """
    raw = (env.get(key) or "").split("#", 1)[0]
    return raw.strip() or default


def _int_or_none(value: str, key: str) -> int | None:
    """Lenient on purpose: a malformed WINDOW_* is eKuiper's problem to reject (provision.sh
    fails fast), and must never crash-loop Analytics — it degrades /api/window, nothing more."""
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        log.warning("ignoring %s=%r — not an integer", key, value)
        return None


def load_config(env: os._Environ | dict | None = None) -> Config:
    env = os.environ if env is None else env
    broker_type = env.get("BROKER_TYPE", "mqtt")
    if broker_type != "mqtt":
        raise ValueError(f'Invalid BROKER_TYPE "{broker_type}" (expected "mqtt")')

    return Config(
        broker_type=broker_type,
        host=env.get("BROKER_HOST", "mosquitto"),
        port=int(env.get("BROKER_PORT", "1883")),
        events_topic=env.get("EVENTS_TOPIC", EVENTS_TOPIC),
        qos=int(env.get("QOS_LEVEL", "1")),
        lag_windows=int(env.get("LAG_WINDOWS", "4")),
        http_port=int(env.get("ANALYTICS_PORT", "3003")),
        maas_url=env.get("MAAS_URL", "http://maas:8000"),
        maas_timeout_ms=int(env.get("MAAS_TIMEOUT_MS", "1000")),
        socketio_cors_origins=env.get("SOCKETIO_CORS_ORIGINS", env.get("CORS_ORIGINS", "*")),
        ring_buffer_size=int(env.get("RING_BUFFER_SIZE", "200")),
        window_type=_text(env, "WINDOW_TYPE", "tumbling").lower(),
        window_unit=_text(env, "WINDOW_UNIT", "ss").lower(),
        window_size=_int_or_none(_text(env, "WINDOW_SIZE", "10"), "WINDOW_SIZE") or 10,
        # Only hopping/session need a step (provision.sh fails fast there); None otherwise.
        window_step=_int_or_none(_text(env, "WINDOW_STEP", ""), "WINDOW_STEP"),
    )
