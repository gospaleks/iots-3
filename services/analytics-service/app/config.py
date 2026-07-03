"""Environment-driven config (mirrors the per-service env tables in REQUIREMENTS §5.3)."""
from __future__ import annotations

import os
from dataclasses import dataclass

from .contracts import KAFKA_TOPIC, MQTT_TOPIC


@dataclass(slots=True)
class Config:
    broker_type: str
    host: str
    port: int
    topic: str
    qos: int  # MQTT only
    group_id: str  # Kafka only — analytics = consumer group B (distinct from storage)
    window_size_sec: float
    alert_threshold: float
    http_port: int


def load_config(env: os._Environ | dict | None = None) -> Config:
    env = os.environ if env is None else env
    broker_type = env.get("BROKER_TYPE", "mqtt")
    if broker_type not in ("mqtt", "kafka"):
        raise ValueError(f'Invalid BROKER_TYPE "{broker_type}" (expected "mqtt" | "kafka")')

    is_mqtt = broker_type == "mqtt"
    return Config(
        broker_type=broker_type,
        host=env.get("BROKER_HOST", "mosquitto" if is_mqtt else "kafka"),
        port=int(env.get("BROKER_PORT", "1883" if is_mqtt else "9092")),
        topic=env.get("TOPIC", MQTT_TOPIC if is_mqtt else KAFKA_TOPIC),
        qos=int(env.get("QOS_LEVEL", "1")),
        # Distinct from storage's group so both consumer groups receive the full stream.
        group_id=env.get("ANALYTICS_GROUP_ID", "iots-analytics"),
        window_size_sec=float(env.get("WINDOW_SIZE_SEC", "10")),
        alert_threshold=float(env.get("ALERT_THRESHOLD", "50.0")),
        http_port=int(env.get("ANALYTICS_PORT", "3003")),
    )
