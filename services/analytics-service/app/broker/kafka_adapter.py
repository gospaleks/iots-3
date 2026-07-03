"""Kafka subscriber via aiokafka. Analytics uses its own consumer group (group B),
distinct from storage, so both receive the full stream."""
from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator

from aiokafka import AIOKafkaConsumer
from aiokafka.errors import KafkaError

from ..config import Config
from ..contracts import ReceivedMeta, SensorMessage
from .adapter import SubscriberAdapter, now_ms

log = logging.getLogger("analytics.kafka")


class KafkaAdapter(SubscriberAdapter):
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg

    async def messages(self) -> AsyncIterator[tuple[SensorMessage, ReceivedMeta]]:
        cfg = self._cfg
        while True:
            consumer = AIOKafkaConsumer(
                cfg.topic,
                bootstrap_servers=f"{cfg.host}:{cfg.port}",
                group_id=cfg.group_id,
                auto_offset_reset="latest",
                enable_auto_commit=True,
            )
            try:
                await consumer.start()
                log.info("subscribed to %s (group=%s)", cfg.topic, cfg.group_id)
                async for m in consumer:
                    received = now_ms()
                    parsed = _parse(m.value)
                    if parsed is not None:
                        yield parsed, ReceivedMeta(m.topic, received)
            except KafkaError as err:
                log.warning("kafka error (%s) — reconnecting in 1s", err)
                await asyncio.sleep(1)
            finally:
                await consumer.stop()


def _parse(payload: bytes | None) -> SensorMessage | None:
    if payload is None:
        return None
    try:
        return SensorMessage.from_dict(json.loads(payload))
    except (ValueError, KeyError):
        return None
