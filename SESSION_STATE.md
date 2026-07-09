# SESSION_STATE.md
## IoTS Project 3 — living state / cold-resume tracker

> **Read this first when resuming.** It is the source of truth for *where we are*. Then open
> `IMPLEMENTATION_PLAN.md` (roadmap) and the specific `docs/phases/PHASE-N-*.md` for the phase
> you're starting/continuing.
>
> **Update discipline:** each phase's *Write-back* step edits the status table below and the
> "Last action / Next action" block. Keep it short and truthful — no aspirational entries.

---

## Current position

- **Iteration:** Phase 4 complete → ready for Phase 5.
- **Next action:** **Start Phase 5** (`docs/phases/PHASE-5-analytics-maas-integration.md`) —
  wire Analytics → MaaS REST (`POST /predict`) with a small timeout + CEP-only fallback;
  emit `[PREDICTIVE ALERT]` on event-of-interest types; mount a Socket.IO server on the
  Analytics ASGI app that pushes `event` + `alert` channels + REST snapshot routes for the
  web app. **Core E2E done at the end of Phase 5.**
- **Last action:** Phase 4 — authored `maas/app.py` (FastAPI + Pydantic; lifespan loads model
  ONCE; `/health` `/model/info` `/predict`; 400 on wrong history length / unknown device;
  parity check on startup vs `FEATURE_NAMES`/`LAG_WINDOWS`), `maas/Dockerfile` (python:3.12-slim,
  ships artifact in the image), bumped `requirements.txt` (+ fastapi, uvicorn), added `maas`
  service to compose under **`ml` profile** (port 8000). Verified live: `/health` ok,
  `/model/info` returns full meta (task/algorithm/features/metrics/version), `/predict` valid
  → 26.70 °C, wrong length → 400, unknown device → 400, suffixed device (`-27`) → same
  prediction as bare (base_device() normalization confirmed).
- **Branch:** `main` (Phases 0–2 committed/pushed by user; Phase-3 + Phase-4 changes uncommitted).

---

## Phase status

| Phase | Name | Status | Notes |
|-------|------|--------|-------|
| 0 | Foundation & shared contracts | ✅ DONE | P2 base E2E verified (57.8k rows, 100 devices); wire=°C; contracts+thresholds+env keys frozen |
| 1 | eKuiper CEP (stream + rollup + threshold rule) | ✅ DONE | `2.2.1-slim`; tumbling/ss/10; WINDOW_METRICS+HIGH_CO via REST; window switch verified |
| 2 | Analytics consumes events | ✅ DONE | subscribes `sensors/events`; per-device buffer 4/4; `/stats` depths; HIGH_CO logged; no ML yet |
| 3 | MaaS offline training | ✅ DONE | shared `features.py`; chrono split; RF (test R²=0.988, MAE=0.073°C); 14 MB artifact + meta |
| 4 | MaaS service | ✅ DONE | FastAPI (lifespan load-once); /health /model/info /predict; 400 handling; Dockerized under `ml` profile |
| 5 | Analytics ↔ MaaS integration | ⬜ NOT STARTED | REST + timeout/fallback; [PREDICTIVE ALERT]; Socket.IO event/alert + REST snapshots |
| 6 | eKuiper advanced rules | ⬜ NOT STARTED | sustained-high + heat/dry correlation |
| 7 | Web app (React+Vite) | ⬜ NOT STARTED | MQTT-WS; feeds + predicted-vs-actual chart |
| 8 | Delivery | ⬜ NOT STARTED | E2E gate; README; GitHub |

Legend: ⬜ NOT STARTED · 🟨 IN PROGRESS · ✅ DONE · ⛔ BLOCKED

---

## Locked decisions (mirror of IMPLEMENTATION_PLAN §0 — quick reference)

- **D1 ML task:** temperature forecasting (regression), target = next-window `avg_temp`.
- **D2 Model:** RandomForestRegressor, global + device one-hot.
- **D3/D4 Features:** lag over last `LAG_WINDOWS=4` window aggregates; shared `maas/features.py`.
- **D5 Unit:** Celsius (verify wire in Phase 1).
- **D6 Window:** env-templated at provision (`WINDOW_TYPE/UNIT/SIZE/STEP`, default `tumbling/ss/10/—`).
- **D7 Rules:** rollup (`WINDOW_METRICS`) + event rules (threshold now; sustained + heat/dry later).
- **D8 Thresholds:** env-driven, °C-calibrated (`TEMP_HIGH=28`, `CO_HIGH=0.010`, `HUMIDITY_LOW=40`, `SMOKE_HIGH=0.030`, `SUSTAINED_TEMP=25`).
- **D9 Analytics:** thin orchestrator, no self-windowing.
- **D10 Web app:** React+Vite+shadcn/ui(base-ui)+Tailwind; live via Socket.IO to Analytics; REST snapshots via axios+TanStack Query; non-blocking.
- **D11 UI transport:** Analytics hosts a Socket.IO server (`event` + `alert` channels) + REST snapshot routes; the browser does **not** speak MQTT (no `ui/alerts` topic).

## Parity invariants (never break silently)

- `WINDOW_SIZE` matches between eKuiper provision and `train.py`.
- `LAG_WINDOWS` matches across `train.py`, MaaS `features.py`, Analytics buffer.
- Temperature unit consistent (°C) across dataset, wire, thresholds, model.
- `RAW_TOPIC=sensors/telemetry` (never rename); eKuiper out = `sensors/events`; UI via Socket.IO from Analytics (no MQTT in the browser).

---

## Open items / risks carried forward

- [x] **Wire-unit check** (done Phase 0): Ingestion publishes **°C** with no conversion — raw
      wire 19.7/24.4/22.1, DB `temp` min 0.1 / max 28.3 / avg 22.35. No `train.py` conversion
      needed. (Analytics P2 log still prints a cosmetic `°F` suffix — removed in Phase 2.)
- [x] **E2E on a Docker host** (done Phase 0): full `--profile mqtt --profile app` stack came up
      clean — Storage wrote 57.8k rows across 100 devices, Analytics emitted window/[INFO]/[LATENCY]
      lines, **no Kafka errors**.
- [x] eKuiper tag pinned (Phase 1): **`lfedge/ekuiper:2.2.1-slim`** (verified on Docker Hub, pulled).
- **Carry to Phase 2:** `window_start`/`window_end` are emitted as **epoch-ms integers** (eKuiper
  native), not the fractional-seconds shown in the contract example — Analytics/chart must treat
  them as ms. `HIGH_CO` (per-message co>threshold) does **not** fire on the current replay sample
  (raw co ~0.003–0.005 < 0.010); wiring proven by temporarily lowering the threshold. Consider
  re-tuning `CO_HIGH` or relying on the Phase-6 windowed rules for demoable events.

---

## Change log (newest first)

- **2026-07-09** — Phase 4 done: MaaS FastAPI service. `maas/app.py` uses the FastAPI
  `lifespan` handler to `joblib.load(MODEL_PATH)` and read `model_meta.json` **once** at
  startup (no training at boot); parity guard fails fast if `model.n_features_in_` disagrees
  with `len(FEATURE_NAMES)` or `meta.lag_windows != LAG_WINDOWS`. Pydantic models
  (`HistoryWindow`, `PredictRequest`, `PredictResponse`) power the free `/docs` Swagger UI.
  Validation returns 400 (never 500) for wrong `history` length or an unknown device
  (`base_device()` strips the ingestion `-N` suffix — the suffixed id `1c:bf:ce:15:ec:4d-27`
  produces the same prediction as the bare MAC). `/predict` calls
  `feature_vector(history, device)` from the shared `features.py` verbatim (D4). `maas/Dockerfile`
  (python:3.12-slim, requirements pinned, artifact copied to `/models/` to match the `.env`
  default `MODEL_PATH=/models/model.joblib`) ships the model IN the image; `.dockerignore`
  keeps `train.py` and pycache out. Added `maas` compose service under new **`ml` profile**
  (port 8000, respects `.env` MAAS_PORT/MODEL_PATH/LAG_WINDOWS/CORS_ORIGINS). Live smoke:
  `/health` → ok; `/model/info` returns full meta incl. `metrics.val/test` and `trained_at`;
  `POST /predict` on the message-contract example returns `prediction: 26.70 °C`, `unit:"C"`,
  `model_version:"1.0"`. Compose header + phase table say bring up with
  `--profile mqtt --profile app --profile cep --profile ml up -d`. Next → Phase 5.
- **2026-07-08** — Phase 3 done: offline MaaS training. `maas/features.py` is the **single** feature
  transform (imported by train + service): `windows_from_readings` (bucket raw readings into
  WINDOW_SIZE=10s aggregates) + `feature_vector` (19 features: 4-lag avg_temp/avg_humidity/avg_co,
  latest max_temp, rolling mean/std, trend, 3-device one-hot) with `base_device()` stripping the
  ingestion `-N` suffix so train (bare MACs) and serve (suffixed) share the one-hot. `train.py`:
  drop `temp==0` (7 rows), per-device chronological 70/15/15 split (no shuffle) then concat,
  RandomForest(n_estimators=150, max_depth=16, min_samples_leaf=25) — bounded to keep the artifact
  14 MB (`compress=3`); unbounded trees ballooned to 737 MB **and** overfit. Metrics saved to
  `models/metrics.json` + `models/model_meta.json`: **val** MAE 0.058 / RMSE 0.369 / R² 0.985;
  **test** MAE 0.073 / RMSE 0.420 / R² 0.988. Verified via load + predict smoke test in the
  container (no host sklearn). `model.joblib` gitignored; the JSON meta is kept. Next → Phase 4.
- **2026-07-07** — Phase 2 done: rewired the FastAPI Analytics service to consume `sensors/events`.
  `config.py` now reads `EVENTS_TOPIC`/`LAG_WINDOWS` (dropped `WINDOW_SIZE_SEC`/`ALERT_THRESHOLD`);
  `contracts.py` mirrors the event payload (retired `SensorMessage`); the broker adapter yields raw
  event dicts; new `app/events.py` `EventProcessor` routes by `event_type` and keeps a per-device
  `deque(maxlen=LAG_WINDOWS)` of rollups; `metrics.py` counts events by type; `main.py` dropped the
  window task; deleted `app/window.py`. `/stats` exposes `bufferDepthByDevice` + `eventsByType`.
  Verified live end-to-end (buffers 4/4 × 100 devices, `[EVENT] HIGH_CO` when threshold lowered).
  Next → Phase 3.
- **2026-07-07** — Phase 1 done: added `ekuiper` + one-shot `ekuiper-provision` services to
  compose under a new `cep` profile (pinned `lfedge/ekuiper:2.2.1-slim`). Authored the typed
  `ekuiper/streams/sensor_stream.json` (ts as FLOAT to avoid silent NULLs on fractional epoch
  seconds), rollup rule `window_metrics.json` (`WINDOW_METRICS`, no HAVING) and threshold rule
  `high_co.json` (`HIGH_CO`), plus `ekuiper/provision.sh` — waits for REST, builds the GROUP BY
  window clause from env (D6), create-if-missing stream, DELETE-then-POST rules (idempotent).
  Verified: auto-provision on `up`, both event types on `sensors/events`, counters climbing (0
  exceptions), tumbling→sliding switch with no SQL edits. Next → Phase 2.
- **2026-07-07** — Phase 0 done: verified the reused P2 base runs end-to-end on Docker
  (Storage → TimescaleDB 57.8k rows/100 devices, Analytics window logs, no Kafka errors);
  confirmed the wire unit is **Celsius** (no conversion); extended `shared/message-contract.md`
  with the `sensors/events` / alert / MaaS REST contracts; added `shared/thresholds.md`; added
  the P3 env keys (window/thresholds/MaaS/Socket.IO) to `docker/.env.example`. `docker compose
  config` parses. Next → Phase 1.
- **2026-07-05** — Planning iteration: locked D1–D11; recalibrated thresholds; authored
  `IMPLEMENTATION_PLAN.md`, this tracker, and `docs/phases/PHASE-0..8`.
