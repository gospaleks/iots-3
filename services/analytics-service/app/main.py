"""FastAPI app: subscribes to eKuiper events, routes/buffers them, exposes /health /stats.

Project 3 (Phase 2): Analytics is repointed from the raw telemetry topic to
`sensors/events`. The Project 2 hand-rolled tumbling window is gone — eKuiper owns
windowing (D9). A single background task pulls parsed events from the broker adapter
and hands each to the EventProcessor, which routes by `event_type` and keeps a
per-device ring buffer of the last LAG_WINDOWS rollups. No ML yet (Phase 5).
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .broker.adapter import SubscriberAdapter, create_adapter
from .config import Config, load_config
from .events import EventProcessor
from .metrics import Metrics

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("analytics")


async def consume_loop(adapter: SubscriberAdapter, processor: EventProcessor) -> None:
    async for event, meta in adapter.messages():
        processor.handle(event, meta)


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg: Config = app.state.cfg
    metrics = Metrics()
    processor = EventProcessor(cfg, metrics)
    adapter = create_adapter(cfg)

    app.state.metrics = metrics
    app.state.processor = processor

    log.info(
        "analytics starting: broker=%s endpoint=%s:%d events_topic=%s lag_windows=%d",
        cfg.broker_type, cfg.host, cfg.port, cfg.events_topic, cfg.lag_windows,
    )
    consume_task = asyncio.create_task(consume_loop(adapter, processor))
    try:
        yield
    finally:
        consume_task.cancel()
        await asyncio.gather(consume_task, return_exceptions=True)
        log.info("analytics stopped")


app = FastAPI(lifespan=lifespan)
app.state.cfg = load_config()

# CORS for an optional browser web app (additive: only sets response headers).
# CORS_ORIGINS is a comma-separated allowlist; default "*" reflects any origin (local demo default).
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/stats")
async def stats() -> dict:
    metrics: Metrics = app.state.metrics
    processor: EventProcessor = app.state.processor
    cfg: Config = app.state.cfg
    return {
        "broker": cfg.broker_type,
        "eventsTopic": cfg.events_topic,
        "lagWindows": cfg.lag_windows,
        "bufferDepthByDevice": processor.buffer_depths(),
        **metrics.snapshot(),
    }


def run() -> None:
    cfg = app.state.cfg
    uvicorn.run(app, host="0.0.0.0", port=cfg.http_port, log_level="warning")


if __name__ == "__main__":
    run()
