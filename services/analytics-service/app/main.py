"""FastAPI app: subscribes to eKuiper events, enriches with MaaS forecast, exposes
`/health` `/stats` + Socket.IO (`event` / `alert`) + REST snapshots (`/api/*`).

Phase 2 rewired subscription to `sensors/events`. Phase 5 turns this into the
orchestrator: MaaS call + Socket.IO push to the browser (D11). The Socket.IO
server is mounted as an ASGI wrapper around the FastAPI app so REST + `/socket.io`
share the same port (ANALYTICS_PORT, default 3003).
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import socketio
import uvicorn
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from .broker.adapter import SubscriberAdapter, create_adapter
from .config import Config, load_config
from .events import EventProcessor
from .maas_client import MaasClient
from .metrics import Metrics
from .socketio_server import SioBus

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("analytics")


async def consume_loop(adapter: SubscriberAdapter, processor: EventProcessor) -> None:
    async for event, meta in adapter.messages():
        try:
            await processor.handle(event, meta)
        except Exception as e:  # noqa: BLE001 — one bad event must not kill the loop.
            log.exception("event handler error: %s", e)


# Load config first — SioBus needs CORS at construction time so it can be created
# eagerly, letting the Socket.IO ASGI wrapper share the same instance the lifespan
# passes into the EventProcessor.
_cfg: Config = load_config()
_sio_bus = SioBus(_cfg.socketio_cors_origins, ring_size=_cfg.ring_buffer_size)


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg: Config = app.state.cfg
    metrics = Metrics()
    maas = MaasClient(cfg.maas_url, cfg.maas_timeout_ms)
    processor = EventProcessor(cfg, metrics, maas=maas, sio=_sio_bus)
    adapter = create_adapter(cfg)

    app.state.metrics = metrics
    app.state.processor = processor
    app.state.maas = maas
    app.state.sio_bus = _sio_bus

    log.info(
        "analytics starting: broker=%s endpoint=%s:%d events_topic=%s lag_windows=%d maas=%s timeout=%dms",
        cfg.broker_type, cfg.host, cfg.port, cfg.events_topic, cfg.lag_windows,
        cfg.maas_url, cfg.maas_timeout_ms,
    )
    consume_task = asyncio.create_task(consume_loop(adapter, processor))
    try:
        yield
    finally:
        consume_task.cancel()
        await asyncio.gather(consume_task, return_exceptions=True)
        await maas.close()
        log.info("analytics stopped")


fastapi_app = FastAPI(lifespan=lifespan)
fastapi_app.state.cfg = _cfg
fastapi_app.state.sio_bus = _sio_bus  # exposed before lifespan for the REST routes below

_cors_origins = _cfg.socketio_cors_origins
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors_origins.split(",")] if _cors_origins != "*" else ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@fastapi_app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@fastapi_app.get("/stats")
async def stats() -> dict:
    metrics: Metrics = fastapi_app.state.metrics
    processor: EventProcessor = fastapi_app.state.processor
    cfg: Config = fastapi_app.state.cfg
    return {
        "broker": cfg.broker_type,
        "eventsTopic": cfg.events_topic,
        "lagWindows": cfg.lag_windows,
        "maasUrl": cfg.maas_url,
        "bufferDepthByDevice": processor.buffer_depths(),
        **metrics.snapshot(),
        **_sio_bus.stats(),
    }


# ─── REST snapshot routes (§message-contract "Snapshots") ────────────────────────
@fastapi_app.get("/api/events")
async def api_events(limit: int = Query(50, ge=1, le=1000)) -> list[dict]:
    return _sio_bus.snapshot_events(limit)


@fastapi_app.get("/api/alerts")
async def api_alerts(limit: int = Query(50, ge=1, le=1000)) -> list[dict]:
    return _sio_bus.snapshot_alerts(limit)


@fastapi_app.get("/api/forecast/{device}")
async def api_forecast(device: str, limit: int = Query(100, ge=1, le=1000)) -> list[dict]:
    return _sio_bus.snapshot_forecast(device, limit)


@fastapi_app.get("/api/devices")
async def api_devices() -> dict:
    processor: EventProcessor = fastapi_app.state.processor
    return {"devices": sorted(processor.buffer_depths().keys())}


# ─── ASGI: Socket.IO wraps FastAPI so both share the port. Uvicorn serves THIS. ─
asgi_app = socketio.ASGIApp(_sio_bus.sio, other_asgi_app=fastapi_app)


def run() -> None:
    uvicorn.run(asgi_app, host="0.0.0.0", port=_cfg.http_port, log_level="warning")


if __name__ == "__main__":
    run()
