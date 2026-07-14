# IoTS Project 3 — Streaming CEP + ML-as-a-Service over MQTT

Event-driven IoT microservices that evolve the Project 2 pipeline: instead of the Analytics
service hand-coding all its analysis, a dedicated **stream-processing / CEP engine (eKuiper)**
detects events of interest from the raw sensor stream, and a **Model-as-a-Service (MaaS)**
microservice serves a trained ML model over REST. **Analytics becomes an orchestrator** — it
consumes eKuiper's events and enriches each with an ML prediction from MaaS to emit smarter,
predictive alerts. Everything runs in Docker, MQTT-only.

> This repo continues from **Project 2** (MQTT-vs-Kafka benchmark). Ingestion, Storage,
> TimescaleDB, Mosquitto, and the message contract are **reused unchanged**; Analytics is
> **modified**; eKuiper, MaaS, and the web app are **new**. See
> [docs/REQUIREMENTS-IoTS-3.md](docs/REQUIREMENTS-IoTS-3.md) (source of truth) and
> [docs/IoTS-3-EXPLAINED.md](docs/IoTS-3-EXPLAINED.md) (the explainer).

**`RAW_TOPIC = sensors/telemetry`** (MQTT) — the raw telemetry topic. Ingestion publishes it;
Storage and eKuiper subscribe to it. eKuiper publishes detected events to **`sensors/events`**,
which the enhanced Analytics consumes. Do not rename `sensors/telemetry`.

## Architecture (target state)

```
ingestion (NestJS) ──publish sensors/telemetry──▶ Mosquitto (MQTT) ──┬──▶ storage (NestJS) ──▶ TimescaleDB
                                                                     └──▶ eKuiper (CEP rules)
                                                                            │ publish sensors/events
                                                                            ▼
                                                            analytics (FastAPI) ──REST /predict──▶ MaaS (ML model)
                                                                            │
                                                                            ▼  enriched / predictive alerts
                                                                     web app (any tech)
```

- **ingestion** — the only publisher; device simulator (replays the real dataset or generates),
  stamping each message with a per-device `seq` and `sent_at_ms`. Burst mode. *(reused)*
- **storage** — the only DB writer; subscribes to `sensors/telemetry`, tracks `seq` integrity,
  writes to a TimescaleDB hypertable (`DIRECT`/`BATCH`, idempotent `ON CONFLICT`). *(reused)*
- **eKuiper** — LF Edge stream/CEP engine; SQL rules over `sensors/telemetry` detect events →
  publishes them to `sensors/events`. *(new — ✅ built, Phase 1)*
- **analytics** — FastAPI; orchestrator that consumes `sensors/events`, buffers per-device rollups,
  calls MaaS `/predict` (with a hard timeout and CEP-only fallback), emits `[PREDICTIVE ALERT]`
  lines and pushes `event`/`alert` to the web app over **Socket.IO** + REST snapshot routes
  under `/api/*`. *(modified — ✅ Phases 2 + 5, all delivered)*
- **MaaS** — Python + FastAPI; a RandomForest next-window temperature forecaster behind
  `POST /predict`, `GET /health`, `GET /model/info`. *(new — ✅ Phases 3–4; the artifact ships
  in the image, loaded once at startup)*
- **web app** — React + Vite + **shadcn/ui** (Base UI, Tailwind v4) + Socket.IO + Recharts;
  visualizes the pipeline: live CEP event stream, predictive alerts, and the actual-vs-forecast
  chart. Readable under any window mode. Non-blocking.
  *(new — ✅ Phase 7, rewritten on shadcn/ui; served by nginx under the `web` profile at :8080)*

The reused services depend only on a broker `BrokerAdapter` interface (Nest DI for the two
NestJS services, an async mirror in the Python analytics service). Project 3 is MQTT-only.

## Reused · Modified · New

| Component | Status | Notes |
|-----------|--------|-------|
| Ingestion Service (NestJS) | **Reused** | Publisher of raw telemetry. |
| Storage Service (NestJS) | **Reused** | Subscriber → TimescaleDB writer. |
| TimescaleDB | **Reused** | Historical store; offline MaaS training source; optional web-app source. |
| Mosquitto (MQTT) | **Reused** | The message backbone. |
| Message contract | **Reused** | `shared/message-contract.md` — eKuiper stream + MaaS features derive from it. |
| Analytics Service (FastAPI) | **Modified** — ✅ Phases 2 + 5 | Consumes `sensors/events`, calls MaaS `/predict` (timeout + CEP-only fallback), emits `[PREDICTIVE ALERT]`, and pushes `event`/`alert` over Socket.IO + REST snapshot routes `/api/*`. |
| eKuiper (Streaming/CEP) | **New** — ✅ Phases 1 + 6 | `WINDOW_METRICS` rollup + `HIGH_CO` (threshold) + `SUSTAINED_HIGH_TEMP` (windowed HAVING) + `HEAT_DRYING` (multi-condition correlation) → `sensors/events`, REST-provisioned. |
| MaaS (Model-as-a-Service) | **New** — ✅ Phase 3/4 | RandomForest forecaster (test R²=0.988) behind FastAPI `/predict /health /model/info`; artifact ships in image. |
| Web app | **New** — ✅ Phase 7 | React + shadcn/ui + Socket.IO dashboard: pipeline rail, live event stream with a plain-English legend, predictive alerts, actual-vs-forecast chart. Survives any window mode. Non-blocking. |

## Repository layout

```
docs/         REQUIREMENTS-IoTS-3.md (source of truth), IoTS-3-EXPLAINED.md, HANDOFF-repo-init-cleanup.md
data/         dataset CSV (gitignored) — MaaS training data
shared/       message-contract.md, dataset_info.md, thresholds.md
services/     npm workspaces: libs/{broker,contracts}, ingestion-service, storage-service, analytics-service (FastAPI)
docker/       docker-compose.yml (mqtt/app/cep profiles), mosquitto/, db/init.sql, .env.example
maas/         features.py (shared transform), train.py, models/ (trained artifact + metrics); REST service in Phase 4
ekuiper/      streams/ + rules/ + provision.sh — REST-provisioned CEP layer (Phase 1)
webapp/       React + shadcn/ui dashboard (src/lib/api.ts, hooks/, components/) — the `web` profile
```

## Tech stack

NestJS (mqtt.js, TypeORM) · FastAPI (aiomqtt) · TimescaleDB · Eclipse Mosquitto · LF Edge
eKuiper (`2.2.1-slim`) · scikit-learn / FastAPI MaaS · Docker Compose.

---

## Environment

All build/run work targets **WSL2 + Docker Desktop (Linux)**.

## Setup (first time)

```bash
# 1. Dataset (gitignored, ~61 MB) — place it here:
#    data/iot_telemetry_data.csv
# 2. Env file:
cp docker/.env.example docker/.env          # BROKER_TYPE=mqtt
# 3. Build the TypeScript services (for host runs / unit tests):
cd services && npm install && npm run build && npm test    # broker unit tests
```

## Running the pipeline

The compose stack uses **profiles**: `timescaledb` is always on, `mqtt` adds Mosquitto,
`app` adds the three reused services, `cep` adds eKuiper + its one-shot provisioner,
`ml` adds MaaS.

```bash
C="docker compose -f docker/docker-compose.yml"

# Broker only:
$C --profile mqtt up -d                                             # TimescaleDB + Mosquitto

# Reused pipeline (ingestion + storage + analytics):
$C --profile mqtt --profile app up -d

# + eKuiper CEP (analytics then consumes sensors/events):
$C --profile mqtt --profile app --profile cep up -d

# + MaaS (POST /predict wraps the trained forecaster):
$C --profile mqtt --profile app --profile cep --profile ml up -d

# + Web app (full stack — dashboard at http://localhost:8080):
$C --profile mqtt --profile app --profile cep --profile ml --profile web up -d

# Tear down (add -v to wipe volumes):
$C --profile mqtt --profile app --profile cep --profile ml --profile web down
```

> eKuiper `depends_on: mosquitto`, so once you add `--profile cep` **every** compose command for
> the stack needs the profile flags. See [ekuiper/README.md](ekuiper/README.md) for provisioning,
> inspection, and the env-templated window. See [maas/README.md](maas/README.md) for the REST
> contract and Swagger UI at [`http://localhost:8000/docs`](http://localhost:8000/docs).

Open the dashboard at [`http://localhost:8080`](http://localhost:8080). Live data arrives over
Socket.IO from Analytics; initial paint uses the `/api/*` REST snapshots so the UI never shows
a blank state. **Non-blocking:** the pipeline runs whether or not the web app is up.

With the demo defaults (`NUM_DEVICES=3`) each device maps 1:1 onto a dataset profile and each
CEP rule lights up a *different* one — `1c:bf…` (26.9 °C) fires `SUSTAINED_HIGH_TEMP`,
`b8:27…` (warm **and** dry) fires `HEAT_DRYING` plus occasional `HIGH_CO`, and `00:0f…` stays
quiet as the baseline. See [shared/thresholds.md](shared/thresholds.md) for the calibration.

### Switching the eKuiper window

The window is env-templated (no SQL edits). Set it in `docker/.env`, then re-run provisioning:

```bash
# WINDOW_TYPE=hopping  WINDOW_STEP=5   → 10s windows emitted every 5s (overlapping)
$C --profile mqtt --profile app --profile cep --profile ml --profile web \
   up -d --force-recreate ekuiper-provision
```

The dashboard header shows the mode it infers from the live data (`window tumbling · 10s` →
`window hopping · 10s / 5s`). `hopping`/`session` **require** `WINDOW_STEP` — provisioning
fails fast if it's missing. `sliding` is supported but emits **one event per incoming message**
by design (a flood, not a bug); the web app absorbs it, but `hopping` is the readable demo.
Keep `WINDOW_SIZE=10` and `LAG_WINDOWS=4` — the MaaS model was trained on those.

### Service control surface (HTTP)

| Service | Port | Endpoints |
|---------|------|-----------|
| ingestion | 3001 | `GET /health`, `GET /stats`, `POST /burst?durationSec=N` |
| storage   | 3002 | `GET /health`, `GET /stats` (received, stored, conflicts, `seq` integrity, transport latency) |
| analytics | 3003 | `GET /health`, `GET /stats` (events by type, per-device rollup buffer depth); **Socket.IO** at `/socket.io` (`event`, `alert` channels); **REST snapshots** `/api/events`, `/api/alerts`, `/api/forecast/{device}`, `/api/devices` |
| maas      | 8000 | `GET /health`, `GET /model/info`, `POST /predict`, `GET /docs` (Swagger) |
| webapp    | 8080 | React + shadcn/ui dashboard (pipeline rail, event stream + legend, predictive alerts, actual-vs-forecast chart) |

```bash
curl -s localhost:3002/stats | python3 -m json.tool      # storage integrity + latency
curl -s localhost:3003/stats | python3 -m json.tool      # analytics stats
curl -s -X POST 'localhost:3001/burst?durationSec=10'    # trigger a burst
curl -s localhost:8000/model/info | python3 -m json.tool # MaaS model card
```

## Tests

```bash
cd services && npm test            # broker factory unit tests
# integration smoke against a running broker:
docker compose -f docker/docker-compose.yml --profile mqtt up -d
BROKER_TYPE=mqtt BROKER_HOST=localhost BROKER_PORT=1883 npm run smoke -w @iots/broker
```

## Documentation

| Doc | Purpose |
|-----|---------|
| [docs/REQUIREMENTS-IoTS-3.md](docs/REQUIREMENTS-IoTS-3.md) | **Source of truth** — what to build (eKuiper, MaaS, enhanced Analytics, web app). |
| [docs/IoTS-3-EXPLAINED.md](docs/IoTS-3-EXPLAINED.md) | The plain-English explainer + build recipes (eKuiper deep-dive, MaaS choices). |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) · [docs/phases/](docs/phases/) | Phased roadmap + per-phase build docs (0–8). |
| [shared/message-contract.md](shared/message-contract.md) · [shared/dataset_info.md](shared/dataset_info.md) · [shared/thresholds.md](shared/thresholds.md) | Payload/topics · dataset schema · °C thresholds + window/feature constants. |
| [CLAUDE.md](CLAUDE.md) · [SESSION_STATE.md](SESSION_STATE.md) | Project reference + change log · session handoff for the next developer. |
| [objasnjenje.md](objasnjenje.md) | **Presentation guide (Serbian)** — maps the deliverable point-by-point to the project brief; includes an elevator pitch. |

## License / context

Academic project (IoTS Project 3). See [docs/REQUIREMENTS-IoTS-3.md §9](docs/REQUIREMENTS-IoTS-3.md) for the deliverables list.
