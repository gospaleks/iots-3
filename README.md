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
  publishes them to `sensors/events`. *(new — later iteration)*
- **analytics** — FastAPI; consumes `sensors/events`, calls MaaS `/predict`, emits enriched
  `[ALERT]`/`[INFO]`. *(modified — later iteration)*
- **MaaS** — Python + FastAPI; a trained model (regression/classification on the time series)
  behind `POST /predict`, `GET /health`, `GET /model/info`. *(new — later iteration)*
- **web app** — visualizes CEP events, predictive alerts, and MaaS predictions. Non-blocking.
  *(new — later iteration)*

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
| Analytics Service (FastAPI) | **Modified** | Consume `sensors/events` + call MaaS REST → enriched alerts. |
| eKuiper (Streaming/CEP) | **New** | SQL rules → `sensors/events`. |
| MaaS (Model-as-a-Service) | **New** | Trained ML model behind REST. |
| Web app | **New** | CEP events + predictions + alerts viewer. |

## Repository layout

```
docs/         REQUIREMENTS-IoTS-3.md (source of truth), IoTS-3-EXPLAINED.md, HANDOFF-repo-init-cleanup.md
data/         dataset CSV (gitignored) — MaaS training data
shared/       message-contract.md, dataset_info.md
services/     npm workspaces: libs/{broker,contracts}, ingestion-service, storage-service, analytics-service (FastAPI)
docker/       docker-compose.yml (mqtt/app profiles), mosquitto/, db/init.sql, .env.example
maas/         NEW — MaaS model service + train.py (placeholder; built later)
ekuiper/      NEW — stream + rule definitions + provision.sh (placeholder; built later)
webapp/       NEW — web app (placeholder; built later)
```

## Tech stack

NestJS (mqtt.js, TypeORM) · FastAPI (aiomqtt) · TimescaleDB · Eclipse Mosquitto · LF Edge
eKuiper *(coming)* · scikit-learn / FastAPI MaaS *(coming)* · Docker Compose.

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

## Running the reused MQTT pipeline (available today)

The compose stack uses **profiles**: `timescaledb` is always on, `mqtt` adds Mosquitto,
`app` adds the three reused services.

```bash
C="docker compose -f docker/docker-compose.yml"

# Broker only:
$C --profile mqtt up -d                     # TimescaleDB + Mosquitto

# Full reused pipeline (ingestion + storage + analytics):
$C --profile mqtt --profile app up -d

# Tear down (add -v to wipe volumes):
$C --profile mqtt --profile app down
```

> **Coming in later iterations:** `ekuiper`, `maas`, the Analytics enhancement, and `webapp`
> will be added to compose so `docker compose up` brings up the full CEP + ML pipeline. This
> README's run section will grow with them.

### Service control surface (HTTP)

| Service | Port | Endpoints |
|---------|------|-----------|
| ingestion | 3001 | `GET /health`, `GET /stats`, `POST /burst?durationSec=N` |
| storage   | 3002 | `GET /health`, `GET /stats` (received, stored, conflicts, `seq` integrity, transport latency) |
| analytics | 3003 | `GET /health`, `GET /stats` (windows, alerts, latency) |

```bash
curl -s localhost:3002/stats | python3 -m json.tool      # storage integrity + latency
curl -s localhost:3003/stats | python3 -m json.tool      # analytics stats
curl -s -X POST 'localhost:3001/burst?durationSec=10'    # trigger a burst
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
| [docs/HANDOFF-repo-init-cleanup.md](docs/HANDOFF-repo-init-cleanup.md) | The repo-init cleanup contract (this iteration). |
| [shared/message-contract.md](shared/message-contract.md) · [shared/dataset_info.md](shared/dataset_info.md) | Payload/topics · dataset schema. |
| [CLAUDE.md](CLAUDE.md) · [SESSION-STATE.md](SESSION-STATE.md) | Project reference + change log · session handoff for the next developer. |

## License / context

Academic project (IoTS Project 3). See [docs/REQUIREMENTS-IoTS-3.md §9](docs/REQUIREMENTS-IoTS-3.md) for the deliverables list.
