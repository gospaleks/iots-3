# IoTS Project 2 — Event-Driven IoT Microservices: MQTT vs Kafka

Comparative evaluation of **MQTT (Eclipse Mosquitto)** and **Apache Kafka (KRaft)** as the
message backbone of a containerized, event-driven IoT pipeline — measuring **throughput,
latency, reliability, and resource cost** across four experimental scenarios.

The headline architectural idea: **one codebase per service**, each depending only on a
`BrokerAdapter` interface. Switching MQTT ↔ Kafka is **one env var (`BROKER_TYPE`) + one
Docker Compose profile** — no code change, no duplicated services.

## Architecture

```
ingestion (NestJS)  ──publish──▶  broker (Mosquitto | Kafka)  ──┬──▶  storage (NestJS) ──▶ TimescaleDB
                                                                └──▶  analytics (FastAPI) ──▶ alerts
```

- **ingestion** — the only publisher; device simulator (replays the real dataset or
  generates), stamping each message with a per-device `seq` and `sent_at_ms`. Burst mode.
- **storage** — the only DB writer; subscribes, tracks `seq` integrity + transport latency,
  writes to a TimescaleDB hypertable (`DIRECT`/`BATCH`, idempotent `ON CONFLICT`).
- **analytics** — FastAPI; 10 s tumbling window → `[ALERT]`/`[INFO]` + dual latency.

`MqttAdapter`/`KafkaAdapter` implement the interface; a factory keyed on `BROKER_TYPE` is
the only code aware of both brokers. The two NestJS services share the adapter via npm
workspaces; the Python service mirrors the same contract. See
[docs/notes/01-broker-abstraction.md](docs/notes/01-broker-abstraction.md).

## Key results (single WSL2 box — see [docs/report.md](docs/report.md))

| | MQTT (Mosquitto) | Kafka (KRaft) |
|---|---|---|
| Throughput @1000 producers | 21–70k msg/s | **130–145k msg/s** |
| Broker RAM | **~4–5 MB** | ~360–580 MB (**~100×**) |
| Transport latency | **~1.2 ms** | ~6.7 ms |
| Loss (A) | ~0 (QoS2@1000: 0.53%) | 0 (durable log) |
| Burst 50→5000 / 30 s outage | absorbed, 0 loss | absorbed, 0 loss |

> MQTT = featherweight, low-latency edge transport. Kafka = high-throughput, durable,
> replayable cloud backbone at ~100× the RAM. Full analysis + the two critical-question
> answers are in the [technical report](docs/report.md).

## Documentation

| Doc | Purpose |
|-----|---------|
| [docs/report.md](docs/report.md) · [sr](docs/sr/izvestaj.md) | **Technical report** — filled results table, findings, critical-question answers |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) · [sr](docs/sr/ZAHTEVI.md) | What to build (spec, scenarios, metrics) |
| [docs/DECISIONS.md](docs/DECISIONS.md) · [sr](docs/sr/ODLUKE.md) | Why — tech/architecture decisions |
| [docs/PLAN.md](docs/PLAN.md) | Implementation plan + per-iteration detail |
| [docs/notes/](docs/notes/) | Presentation crib sheet (key decisions, plain English) |
| [benchmarks/README.md](benchmarks/README.md) | Benchmark harness reference |
| [shared/message-contract.md](shared/message-contract.md) · [shared/dataset_info.md](shared/dataset_info.md) | Payload/topics · dataset schema |

## Tech stack

NestJS (mqtt.js, kafkajs, TypeORM) · FastAPI (aiomqtt, aiokafka) · TimescaleDB · Eclipse
Mosquitto · Apache Kafka (KRaft) · Docker Compose · emqtt-bench / kafka-producer-perf-test.

## Repository layout

```
docs/         REQUIREMENTS, DECISIONS, PLAN, report.md, notes/
data/         dataset CSV (gitignored)
shared/       message-contract.md, dataset_info.md
services/     npm workspaces: libs/{broker,contracts}, ingestion-service, storage-service, analytics-service (FastAPI)
docker/       docker-compose.yml (profiles), mosquitto/, kafka/, db/init.sql, .env.example
benchmarks/   scenario-{a,b,c,d}-*.sh, collect-docker-stats.sh, lib/ (parsers)
results/      {mqtt,kafka}/scenario-{a,b,c,d}/  (run outputs gitignored)
dashboard/    OPTIONAL frontend — Vite + React + shadcn/ui live read-only monitor
```

---

## Setup (first time)

```bash
# 1. Dataset (gitignored, ~61 MB) — place it here:
#    data/iot_telemetry_data.csv
# 2. Env file:
cp docker/.env.example docker/.env
# 3. Build the TypeScript services (for host runs / unit tests):
cd services && npm install && npm run build && npm test    # 5/5 broker tests
# 4. (For the analytics service on the host) Python venv:
cd analytics-service && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

> All commands below assume **WSL2 + Docker Desktop**. `docker compose` commands are shown
> from the repo root with `-f docker/docker-compose.yml`; or `cd docker` and drop the `-f`.

## Running the system

The compose stack uses **profiles**. `timescaledb` is always on; a broker profile picks
the broker; `app` adds the three services; `tools` adds Kafka UI.

```bash
C="docker compose -f docker/docker-compose.yml"

# Broker only (enough for Scenario A load tests):
$C --profile mqtt  up -d            # TimescaleDB + Mosquitto
$C --profile kafka up -d            # TimescaleDB + Kafka (KRaft)

# Full app (the three services as containers) — for normal use + Scenarios B/C/D.
# IMPORTANT: set BROKER_TYPE / BROKER_HOST / BROKER_PORT / TOPIC in docker/.env to match:
#   MQTT  → BROKER_TYPE=mqtt  BROKER_HOST=mosquitto BROKER_PORT=1883 TOPIC=sensors/telemetry
#   Kafka → BROKER_TYPE=kafka BROKER_HOST=kafka     BROKER_PORT=9092 TOPIC=sensor-telemetry
$C --profile mqtt  --profile app up -d
$C --profile kafka --profile app up -d

# Tear down (add -v to wipe volumes):
$C --profile mqtt --profile kafka --profile app down
```

### Service control surface (HTTP)

| Service | Port | Endpoints |
|---------|------|-----------|
| ingestion | 3001 | `GET /health`, `GET /stats`, `POST /burst?durationSec=N` |
| storage   | 3002 | `GET /health`, `GET /stats` (received, stored, conflicts, `seq` integrity, transport latency) |
| analytics | 3003 | `GET /health`, `GET /stats` (windows, alerts, transport + event-to-alert latency) |

```bash
curl -s localhost:3002/stats | python3 -m json.tool      # storage integrity + latency
curl -s localhost:3003/stats | python3 -m json.tool      # analytics latency + alerts
curl -s -X POST 'localhost:3001/burst?durationSec=10'    # trigger a burst
```

### Switching brokers (the one-flag story)

```bash
# edit docker/.env → BROKER_TYPE + BROKER_HOST/BROKER_PORT/TOPIC, then:
$C --profile <mqtt|kafka> --profile app up -d --force-recreate ingestion storage analytics
```

### Dev tooling (optional, dev only)

```bash
$C --profile kafka --profile tools up -d        # Kafka UI → http://localhost:8080
# MQTT: external MQTT Explorer desktop app → localhost:1883  (docs/notes/02-dev-tooling.md)
```

### Optional dashboard (live monitor)

A small **read-only** web UI (Vite + React + shadcn/ui + TanStack Query) that polls the three
services' `/stats` endpoints and visualizes the live system — throughput, transport latency,
`seq` integrity, and the latest analytics window/alerts — for **whichever broker is currently
running**. It is **off the benchmark path**: purely additive, never required, and every
scenario script behaves identically with it stopped. See
[docs/notes/08-dashboard.md](docs/notes/08-dashboard.md). Not part of any compose profile — run
it with `npm run dev`.

**Run the full stack end-to-end (with the dashboard):**

```bash
C="docker compose -f docker/docker-compose.yml"

# 1. Pick the broker in docker/.env (BROKER_TYPE + BROKER_HOST/PORT/TOPIC — see "Switching
#    brokers" above). The services need to allow the dashboard origin via CORS; the default
#    CORS_ORIGINS=* already works, or lock it to:  CORS_ORIGINS=http://localhost:5173
# 2. Bring up DB + broker + the three app services:
$C --profile mqtt --profile app up -d
# 3. Start the dashboard (separate terminal):
cd dashboard && npm install && npm run dev          # → http://localhost:5173
```

Open <http://localhost:5173>. With data flowing you'll see the broker badge, three green health
dots, live published-vs-stored throughput, transport latency, integrity counters (all 0), and
the latest tumbling window (red banner when avg temp ≥ `ALERT_THRESHOLD`).

**Changing things:**

- **Switch broker live:** `$C --profile mqtt --profile app down`, set `BROKER_TYPE=kafka` (+
  `BROKER_HOST/PORT/TOPIC`) in `docker/.env`, then `$C --profile kafka --profile app up -d`.
  The dashboard badge flips to `KAFKA` and transport latency rises (~ms → tens of ms).
- **Point the dashboard elsewhere:** copy `dashboard/.env.example` → `dashboard/.env.local`
  and set `VITE_INGESTION_URL` / `VITE_STORAGE_URL` / `VITE_ANALYTICS_URL`.
- **From the UI:** change the poll interval (1s / 2s / 5s), or hit **Trigger burst** — it calls
  the ingestion `POST /burst` for a live Scenario C spike.
- **Lock down CORS:** set `docker/.env` `CORS_ORIGINS` to specific origins (comma-separated)
  instead of `*`, then recreate the services.

> Prove it's off the benchmark path: stop the dashboard and re-run any `benchmarks/scenario-*.sh`
> — the output is unchanged.

---

## Benchmarks — run & analyze each scenario

Scripts live in [`benchmarks/`](benchmarks/) and write CSVs to
`results/<broker>/scenario-<x>/` (run outputs are gitignored; the folder structure is kept).
`BROKER=mqtt|kafka` selects the target stack **and** the results subfolder — it must match
the running stack's `BROKER_TYPE`.

Load-tool split (DECISIONS §7.2): **A** uses the mandated bench tools (emqtt-bench /
kafka-producer-perf-test); **B/C/D** drive the project's own simulator because they need
correlated, timestamped messages. Reference: [benchmarks/README.md](benchmarks/README.md),
[docs/notes/06-benchmark-harness.md](docs/notes/06-benchmark-harness.md).

> Tip: pipe any summary through `column -s, -t` for a readable table.

### Scenario A — massive ingestion (throughput, loss, CPU/RAM)

**Needs:** broker only. **Tunables:** `DEVICE_COUNTS`, `MSGS_PER_CLIENT`, `INTERVAL_MS`
(MQTT), `QOS` (MQTT), `ACKS`, `RECORD_SIZE` (Kafka).

```bash
# bring up the broker, then run:
docker compose -f docker/docker-compose.yml --profile mqtt up -d
BROKER=mqtt  DEVICE_COUNTS="100 1000" QOS=1            benchmarks/scenario-a-massive-ingestion.sh
BROKER=kafka DEVICE_COUNTS="100 1000" ACKS=1           benchmarks/scenario-a-massive-ingestion.sh
# full grid (per the §8.4 table): loop QoS 0/1/2 (MQTT) and acks 0/1/all (Kafka).
```

Under the hood: MQTT runs `emqtt-bench pub` (load) + `emqtt-bench sub` (counts received);
Kafka runs `kafka-producer-perf-test.sh` + a console consumer count. `collect-docker-stats.sh`
samples CPU/RAM in parallel.

**Analyze:**
```bash
cat results/mqtt/scenario-a/summary-*.csv | column -s, -t
#  broker config device_count sent received loss_pct throughput_msg_s p95_latency_ms note
cat results/kafka/scenario-a/*-resources-agg.csv | column -s, -t
#  container samples cpu_avg cpu_peak mem_avg_mb mem_peak_mb
```
- **Throughput** = `throughput_msg_s`; **loss** = `loss_pct` (`(sent-received)/sent`);
  **p95 latency** Kafka-only (MQTT pub is rate-only → `NA`).
- Compare `cpu_avg`/`mem_avg_mb` of `iots-mosquitto` vs `iots-kafka` for the resource story;
  compare rows across QoS/acks for the reliability-vs-throughput trade-off.

### Scenario B — edge connectivity failure (loss, duplicates, recovery)

**Needs:** broker **+ app** (containerized `iots-ingestion`/`iots-storage`).
**Tunables:** `OUTAGE_SEC` (default 30), `SETTLE_SEC`.

```bash
docker compose -f docker/docker-compose.yml --profile mqtt --profile app up -d
BROKER=mqtt OUTAGE_SEC=30 benchmarks/scenario-b-connectivity-failure.sh
```

Under the hood: snapshots storage `/stats`, runs `docker network disconnect iots2_iot-net
iots-ingestion`, waits `OUTAGE_SEC`, reconnects, then polls until flow resumes. Loss and
duplicates come from the storage **`seq` tracker** (a gap = lost, a repeat = duplicate).

**Analyze:**
```bash
cat results/mqtt/scenario-b/summary-*.csv | column -s, -t
#  broker outage_sec messages_lost duplicates recovery_s received_before received_after
```
- `messages_lost` (seq gaps during the outage), `duplicates` (QoS1/redelivery on reconnect),
  `recovery_s` (reconnect → received count rises again). Compare MQTT vs Kafka.
- **Manual variant:** to test the *broker* mechanism (MQTT persistent session vs Kafka
  offset resume) instead of the client, disconnect the **subscriber** (`iots-storage`) or
  use a longer `OUTAGE_SEC` than the client retry/buffer window.

### Scenario C — burst event load (backlog, loss, recovery)

**Needs:** broker **+ app**, with ingestion at a ~50 msg/s baseline so the burst is a true
50→5000 spike — set in `docker/.env` before `up`: `NUM_DEVICES=5`, `MESSAGES_PER_SECOND=10`,
`BURST_TARGET_RATE=5000`, `WRITE_MODE=BATCH`. **Tunables:** `BURST_SEC`, `WATCH_SEC`.

```bash
docker compose -f docker/docker-compose.yml --profile mqtt --profile app up -d
BROKER=mqtt BURST_SEC=5 WATCH_SEC=40 benchmarks/scenario-c-burst-load.sh
```

Under the hood: fires `POST /burst?durationSec=BURST_SEC`, then samples storage `/stats`
every second (backlog = `buffered`) and `docker stats`.

**Analyze:**
```bash
cat results/mqtt/scenario-c/summary-*.csv     | column -s, -t   # peak_backlog_buffered, messages_lost, recovery_s
cat results/mqtt/scenario-c/timeseries-*.csv  | column -s, -t   # per-second: published, received, buffered, stored
```
- `peak_backlog_buffered` = worst-case rows queued in the storage batch buffer; `messages_lost`
  = seq gaps; `recovery_s` = time for the backlog to drain. Plot the timeseries `buffered`
  column to see the spike + drain.

### Scenario D — real-time alerting latency (transport + event-to-alert)

**Needs:** broker **+ app**; use a low `ALERT_THRESHOLD` (e.g. `20`) in `docker/.env` so
windows actually fire `[ALERT]` (dataset temps ~22 °F-labelled). **Tunables:** `WATCH_SEC`;
run **once per** `QOS_LEVEL` (MQTT) / `KAFKA_ACKS` (Kafka) to compare delivery guarantees.

```bash
docker compose -f docker/docker-compose.yml --profile mqtt --profile app up -d
BROKER=mqtt WATCH_SEC=40 benchmarks/scenario-d-alerting-latency.sh
```

Under the hood: reads transport latency (avg/max) from analytics `/stats`, and event-to-alert
percentiles from the analytics window `[LATENCY]` lines (`docker logs iots-analytics`).

**Analyze:**
```bash
cat results/mqtt/scenario-d/summary-*.csv
#  label,count,min,avg,p50,p95,p99,max          ← event-to-alert distribution across windows
#  transport_latency_ms_avg,..._max,messages,alerts
```
- **Transport latency** = pure broker hop (`received_at_ms − sent_at_ms`); **event-to-alert**
  = end-to-end incl. up to `WINDOW_SIZE_SEC` of window buffering. Expect transport ≪
  event-to-alert, and MQTT transport < Kafka transport.

### Re-running the parsers manually

The `lib/` parsers are pure (stdin/CSV → one CSV row) and reusable:
```bash
kafka-producer-perf-test.sh ... | benchmarks/lib/parse_kafka_perf.py --csv-header
some_numbers_per_line        | benchmarks/lib/latency_stats.py --label x --csv-header
benchmarks/lib/parse_docker_stats.py results/<...>/resources-*.csv --csv-header
```

---

## Tests

```bash
cd services && npm test            # broker factory unit tests (5/5)
# integration smoke against a running broker:
docker compose -f docker/docker-compose.yml --profile mqtt up -d
BROKER_TYPE=mqtt BROKER_HOST=localhost BROKER_PORT=1883 npm run smoke -w @iots/broker
```

## License / context

Academic project (IoTS Project 2). See [docs/REQUIREMENTS.md §10](docs/REQUIREMENTS.md) for
the deliverables list.
