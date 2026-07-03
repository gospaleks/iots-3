"""MQTT subscriber via aiomqtt (the current name of the asyncio-mqtt package)."""
from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

import aiomqtt

from ..config import Config
from ..contracts import ReceivedMeta, SensorMessage
from .adapter import SubscriberAdapter, now_ms

log = logging.getLogger("analytics.mqtt")


class MqttAdapter(SubscriberAdapter):
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg

    async def messages(self) -> AsyncIterator[tuple[SensorMessage, ReceivedMeta]]:
        cfg = self._cfg
        while True:
            try:
                async with aiomqtt.Client(hostname=cfg.host, port=cfg.port) as client:
                    await client.subscribe(cfg.topic, qos=cfg.qos)
                    log.info("subscribed to %s (qos=%d)", cfg.topic, cfg.qos)
                    async for m in client.messages:
                        received = now_ms()
                        parsed = _parse(m.payload)
                        if parsed is not None:
                            yield parsed, ReceivedMeta(str(m.topic), received)
            except aiomqtt.MqttError as err:
                log.warning("mqtt error (%s) — reconnecting in 1s", err)
                import asyncio

                await asyncio.sleep(1)


def _parse(payload: bytes) -> SensorMessage | None:
    try:
        return SensorMessage.from_dict(json.loads(payload))
    except (ValueError, KeyError):
        return None
