# maas/ — Model-as-a-Service

MaaS serves a trained ML model that forecasts the **next window's average temperature** per device.
Analytics calls it over REST (`POST /predict`); **MaaS never touches the broker**.

Background: [docs/REQUIREMENTS-IoTS-3.md §6.2](../docs/REQUIREMENTS-IoTS-3.md),
[docs/IoTS-3-EXPLAINED.md §5](../docs/IoTS-3-EXPLAINED.md). REST contract:
[shared/message-contract.md](../shared/message-contract.md).

## Status

- ✅ **Phase 3 — offline training**: `features.py`, `train.py`, artifact + metrics.
- ✅ **Phase 4 — the FastAPI service** (`/predict` `/health` `/model/info`) + Dockerfile + compose `ml` profile.

## Layout

```
features.py          THE shared feature transform (imported by train.py AND app.py)
train.py             offline training: CSV → RandomForest artifact + metrics
app.py               FastAPI service: /health /model/info /predict — loads model ONCE at startup
Dockerfile           python:3.12-slim; ships the artifact IN the image (no training at boot)
requirements.txt     scikit-learn / numpy / joblib / fastapi / uvicorn (pinned)
models/              build outputs — model.joblib (gitignored), metrics.json, model_meta.json
```

## The model

| | |
|---|---|
| Task (D1) | next-window `avg_temp` regression, per device |
| Algorithm (D2) | `RandomForestRegressor` (n_estimators=150, max_depth=16, min_samples_leaf=25) |
| Features (D3) | 19: 4-lag `avg_temp`/`avg_humidity`/`avg_co`, latest `max_temp`, rolling mean/std of `avg_temp`, trend, 3-device one-hot |
| Unit | Celsius | 
| Metrics (test) | **MAE 0.073 °C · RMSE 0.420 · R² 0.988** (val R² 0.985) |
| Version | 1.0 |

`features.py` is the **single source of truth** for feature building (D4) — `train.py` and the
Phase-4 service both import `feature_vector`, so there is no train/serve skew (the #1 MaaS bug).
`base_device()` strips ingestion's `-N` device suffix so training (bare MACs) and serving
(`MAC-N`) share one device one-hot.

## Train

Training is offline and reproducible (`random_state=42`). It needs scikit-learn, which is **not**
on the host — run it in a container. `train.py` reads the dataset from `DATASET_PATH`
(default `/data/iot_telemetry_data.csv`) and writes to `MODEL_DIR` (default `models/`):

```bash
# from the repo root
docker run --rm -v "$PWD/maas":/app -v "$PWD/data":/data:ro -w /app \
  iots-analytics:latest \
  sh -c "pip install -r requirements.txt && python train.py"
```

(`iots-analytics:latest` is a convenient local Python 3.12 base; any `python:3.12-slim` works too.)

Pipeline: load CSV → **drop `temp==0.0` dropout rows** → per device bucket into `WINDOW_SIZE`-second
aggregates (`windows_from_readings`) → slide `LAG_WINDOWS` windows to form `(X, y=next avg_temp)` →
**per-device chronological 70/15/15 split** (no shuffle) → concat → fit → report MAE/RMSE/R² on
val + test → dump artifact + `metrics.json` + `model_meta.json`.

## Parity invariants (never break silently)

- `WINDOW_SIZE` (default 10s) must equal the eKuiper provision value — changing it ⇒ **retrain**.
- `LAG_WINDOWS` (default 4) must match `features.py`, the Analytics buffer depth, and the
  `/predict` history length. Both come from env (see [shared/thresholds.md](../shared/thresholds.md)).

## Artifact policy

`model.joblib` is a **build output** and is gitignored — it ships inside the MaaS image (Phase 4),
loaded once at startup, never trained at boot. `metrics.json` / `model_meta.json` are small and
kept in git for review. Bounding tree growth + `compress=3` keeps the artifact ~14 MB (unbounded
trees ballooned to ~700 MB **and** overfit).

## Serve (Phase 4)

Build and run the MaaS container (must be trained first — Phase 3):

```bash
docker compose -f docker/docker-compose.yml --profile ml build maas
docker compose -f docker/docker-compose.yml --profile ml up -d maas

curl -s localhost:8000/health                    # {"status":"ok"}
curl -s localhost:8000/model/info | jq           # task/algorithm/features/metrics/version
curl -s -X POST localhost:8000/predict \
  -H 'Content-Type: application/json' \
  -d '{"device":"1c:bf:ce:15:ec:4d","history":[
    {"avg_temp":25.1,"avg_humidity":42.0,"avg_co":0.0060,"max_temp":26.0},
    {"avg_temp":25.6,"avg_humidity":41.5,"avg_co":0.0064,"max_temp":26.4},
    {"avg_temp":25.9,"avg_humidity":41.1,"avg_co":0.0068,"max_temp":26.9},
    {"avg_temp":26.1,"avg_humidity":41.2,"avg_co":0.0071,"max_temp":27.4}]}' | jq
# → { "prediction": 26.70, "target": "next_window_avg_temp", "unit": "C", ... }
```

Free Swagger UI at [`http://localhost:8000/docs`](http://localhost:8000/docs) — try `/predict` from the browser during the demo.

Validation guarantees (`400` — never `500`):

- history length must equal `LAG_WINDOWS` (currently 4).
- device (after stripping the ingestion `-N` suffix via `base_device()`) must be one of the three dataset MACs.

Startup guarantees:

- Model + `model_meta.json` loaded **once** at process startup (lifespan handler); no training at boot.
- Fails fast if `model.n_features_in_ ≠ len(FEATURE_NAMES)` or if `model_meta.lag_windows ≠ LAG_WINDOWS` (parity break).
