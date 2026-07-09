"""MaaS REST service — wraps the Phase-3 RandomForest artifact behind FastAPI.

Endpoints (message-contract §MaaS REST):
  GET  /health       → liveness probe
  GET  /model/info   → task/algorithm/features/metrics/version (from model_meta.json)
  POST /predict      → { device, history: [aggregate x LAG_WINDOWS] } → { prediction, ... }

Invariants:
  - Model + meta loaded ONCE at startup (lifespan handler). Never trained at boot.
  - Feature building imports maas.features verbatim — the single shared transform (D4).
  - Stateless: no broker, no DB. Analytics is the only client.
"""
from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Any

import joblib
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from features import DEVICES, FEATURE_NAMES, LAG_WINDOWS, base_device, feature_vector

MODEL_PATH = os.getenv("MODEL_PATH", "/models/model.joblib")
MODEL_META_PATH = os.getenv("MODEL_META_PATH", os.path.join(os.path.dirname(MODEL_PATH), "model_meta.json"))
MAAS_PORT = int(os.getenv("MAAS_PORT", "8000"))
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*")

log = logging.getLogger("maas")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


class HistoryWindow(BaseModel):
    avg_temp: float
    avg_humidity: float
    avg_co: float
    max_temp: float


class PredictRequest(BaseModel):
    device: str = Field(..., description="Device id — may carry the ingestion `-N` suffix")
    history: list[HistoryWindow] = Field(
        ...,
        description=f"Oldest→newest window aggregates; length must equal LAG_WINDOWS={LAG_WINDOWS}",
    )


class PredictResponse(BaseModel):
    prediction: float
    target: str = "next_window_avg_temp"
    unit: str = "C"
    device: str
    model_version: str


class HealthResponse(BaseModel):
    status: str = "ok"


# ─── Lifespan: load model + meta ONCE ──────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("loading model from %s", MODEL_PATH)
    model = joblib.load(MODEL_PATH)

    with open(MODEL_META_PATH, "r", encoding="utf-8") as f:
        meta: dict[str, Any] = json.load(f)

    # Parity check — fail fast if the artifact and features.py disagree.
    n_expected = len(FEATURE_NAMES)
    n_actual = getattr(model, "n_features_in_", None)
    if n_actual is not None and n_actual != n_expected:
        raise RuntimeError(
            f"feature-count mismatch: model expects {n_actual}, features.py builds {n_expected}"
        )
    if meta.get("lag_windows") != LAG_WINDOWS:
        raise RuntimeError(
            f"LAG_WINDOWS mismatch: meta={meta.get('lag_windows')} env={LAG_WINDOWS}"
        )

    app.state.model = model
    app.state.meta = meta
    log.info(
        "model ready | version=%s features=%d lag_windows=%d window_size_sec=%s",
        meta.get("version"), n_expected, LAG_WINDOWS, meta.get("window_size_sec"),
    )
    yield


app = FastAPI(
    title="IoTS MaaS — Temperature Forecaster",
    description="Next-window `avg_temp` regression (RandomForest). See message-contract §MaaS REST.",
    version="1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS.split(",")] if CORS_ORIGINS != "*" else ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@app.get("/model/info")
def model_info() -> dict[str, Any]:
    m = app.state.meta
    return {
        "task": m.get("task"),
        "algorithm": m.get("algorithm"),
        "features": m.get("features", FEATURE_NAMES),
        "lag_windows": m.get("lag_windows", LAG_WINDOWS),
        "window_size_sec": m.get("window_size_sec"),
        "unit": m.get("unit", "C"),
        "devices": m.get("devices", list(DEVICES)),
        "metrics": m.get("metrics", {}),
        "trained_at": m.get("trained_at"),
        "version": m.get("version", "1.0"),
    }


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest) -> PredictResponse:
    if len(req.history) != LAG_WINDOWS:
        raise HTTPException(
            status_code=400,
            detail=f"history length {len(req.history)} != LAG_WINDOWS={LAG_WINDOWS}",
        )

    if base_device(req.device) not in DEVICES:
        raise HTTPException(
            status_code=400,
            detail=f"unknown device '{req.device}' (base '{base_device(req.device)}' not in {list(DEVICES)})",
        )

    try:
        x = feature_vector([h.model_dump() for h in req.history], req.device)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    yhat = float(app.state.model.predict([x])[0])
    return PredictResponse(
        prediction=yhat,
        device=req.device,
        model_version=str(app.state.meta.get("version", "1.0")),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=MAAS_PORT, log_level="info")
