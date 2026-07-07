"""Environment-driven config (mirrors the per-service env tables in REQUIREMENTS §5.3).

Project 3: Analytics consumes eKuiper output on `sensors/events` (not the raw telemetry
topic) and keeps the last `LAG_WINDOWS` rollups per device. eKuiper owns windowing (D9),
so the Project 2 tumbling-window / alert-threshold knobs are gone.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from .contracts import EVENTS_TOPIC


@dataclass(slots=True)
class Config:
    broker_type: str
    host: str
    port: int
    events_topic: str
    qos: int  # MQTT only
    lag_windows: int
    http_port: int


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
    )
