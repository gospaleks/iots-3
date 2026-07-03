"""Broker abstraction — the Python mirror of @iots/broker's SubscriberAdapter.

Analytics is subscribe-only. Each adapter exposes a single async generator that
yields (SensorMessage, ReceivedMeta) pairs; the factory keyed on BROKER_TYPE is the
only place that knows both brokers exist (mirrors createBrokerAdapter in TS).
"""
from __future__ import annotations

import time
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from ..config import Config
from ..contracts import ReceivedMeta, SensorMessage


def now_ms() -> int:
    return int(time.time() * 1000)


class SubscriberAdapter(ABC):
    @abstractmethod
    def messages(self) -> AsyncIterator[tuple[SensorMessage, ReceivedMeta]]:
        """Connect, subscribe, and yield parsed messages until cancelled.

        Implementations reconnect on transient broker errors; cancellation
        (shutdown) propagates out cleanly to disconnect.
        """
        ...


def create_adapter(cfg: Config) -> SubscriberAdapter:
    """The one switch on broker type."""
    if cfg.broker_type == "mqtt":
        from .mqtt_adapter import MqttAdapter

        return MqttAdapter(cfg)
    if cfg.broker_type == "kafka":
        from .kafka_adapter import KafkaAdapter

        return KafkaAdapter(cfg)
    raise ValueError(f"Unsupported broker type: {cfg.broker_type}")
