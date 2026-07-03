"""FastAPI app: subscribes to the broker, runs a tumbling window, exposes /health /stats.

Two background tasks share the single asyncio event loop:
  - consume_loop: pulls (message, meta) from the broker adapter, records transport
    latency, and feeds the window accumulator.
  - window.run(): closes a window every WINDOW_SIZE_SEC, logging summaries + alerts.
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
from .metrics import Metrics
from .window import TumblingWindow

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("analytics")


async def consume_loop(adapter: SubscriberAdapter, window: TumblingWindow, metrics: Metrics) -> None:
    async for msg, meta in adapter.messages():
        metrics.observe_transport(meta.received_at_ms - msg.sent_at_ms)
        window.add(msg, meta)


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg: Config = app.state.cfg
    metrics = Metrics()
    window = TumblingWindow(cfg, metrics)
    adapter = create_adapter(cfg)

    app.state.metrics = metrics
    app.state.window = window

    log.info(
        "analytics starting: broker=%s endpoint=%s:%d topic=%s window=%ss threshold=%.1f°F",
        cfg.broker_type, cfg.host, cfg.port, cfg.topic, cfg.window_size_sec, cfg.alert_threshold,
    )
    consume_task = asyncio.create_task(consume_loop(adapter, window, metrics))
    window_task = asyncio.create_task(window.run())
    try:
        yield
    finally:
        window.stop()
        for task in (consume_task, window_task):
            task.cancel()
        await asyncio.gather(consume_task, window_task, return_exceptions=True)
        log.info("analytics stopped")


app = FastAPI(lifespan=lifespan)
app.state.cfg = load_config()

# CORS for the optional dashboard (additive: only sets response headers, off the benchmark path).
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
    cfg: Config = app.state.cfg
    return {
        "broker": cfg.broker_type,
        "windowSizeSec": cfg.window_size_sec,
        "alertThreshold": cfg.alert_threshold,
        **metrics.snapshot(),
    }


def run() -> None:
    cfg = app.state.cfg
    uvicorn.run(app, host="0.0.0.0", port=cfg.http_port, log_level="warning")


if __name__ == "__main__":
    run()
