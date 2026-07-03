# Session State / Handoff

> Where we left off — read this first when resuming (especially in a new session or after switching to WSL). The authoritative running log is [CLAUDE.md](CLAUDE.md); the roadmap is [docs/PLAN.md](docs/PLAN.md).

**Last updated:** 2026-06-02
**Branch:** `main`
**Environment switch:** 🔀 moving from Windows → **WSL2** for all build/run work from here on.

---

## Status at a glance

| Iteration | What | Status |
|-----------|------|--------|
| 0 | Docs reorg, scaffolding, contracts, CLAUDE.md, README | ✅ committed `add32f2`, pushed |
| 1 | Infrastructure (TimescaleDB + Mosquitto + Kafka KRaft, compose profiles) | ✅ **verified in WSL2** (both stacks up, hypertable + smoke tests green) |
| 2 | Shared NestJS libs (BrokerAdapter + contracts) | ✅ **verified in WSL2** (build + 5/5 unit, MQTT/Kafka smoke round-trip) |
| 2.5 | Dev tooling (kafka-ui `tools` profile) + docs/notes | ✅ **verified in WSL2** |
| 3 | Ingestion Service (NestJS) | ✅ **verified in WSL2** (MQTT+Kafka publish, burst→5000/s, container) |
| 4 | Storage Service (NestJS) | ✅ **verified in WSL2** (direct/batch, time-flush, ON CONFLICT, MQTT+Kafka) |
| 5 | Analytics Service (FastAPI) | ✅ **verified in WSL2** (10s window, [ALERT]/[INFO], dual latency, MQTT+Kafka) |
| 6 | Benchmark harness | ✅ **verified in WSL2** (A on both brokers, parsers unit-tested, B/C/D wired) |
| 7 | Experiments + report | ✅ **done in WSL2** (matrix run both brokers, `docs/report.md` filled) |
| 8 | Dashboard (optional) | ⬜ optional, last |

## ✅ Done so far

- All planning docs corrected and in `docs/` (REQUIREMENTS, DECISIONS §7, PLAN + plan/00–08).
- Contracts in `shared/` (`dataset_info.md`, `message-contract.md`).
- Dataset CSV is in `data/iot_telemetry_data.csv` (61 MB, **gitignored** — re-add it on the WSL side, it won't come via git pull).
- Iteration 1 infra files written: `docker/docker-compose.yml`, `docker/db/init.sql`, `docker/mosquitto/mosquitto.conf`, `docker/.env.example`, `docker/kafka/README.md`.
- `docker compose config` passes (syntax valid). Stack has **not** been started yet.

## ✅ Core project complete (Iterations 0–7)

All mandatory deliverables are done and verified in WSL2: three services + both brokers,
the benchmark harness, the full experiment runs, and **[docs/report.md](docs/report.md)**
(filled §8.4 table, per-scenario findings, both critical questions answered). Only the
**optional dashboard (Iteration 8)** remains — see [docs/plan/08-dashboard.md](docs/plan/08-dashboard.md).
To deepen results: run the 10000-device rows and a *subscriber*-outage Scenario B
(commands in [benchmarks/README.md](benchmarks/README.md)); both are documented as
not-run scope notes in the report.

---

## ▶️ (superseded) Resume here (Iteration 7 — Experiments + report)

Iterations 0–6 (+2.5 dev tooling) are done and verified in WSL2 — **all three services, both brokers, and the benchmark harness work**. Next: **Iteration 7 — Experiments + report** — see [docs/plan/07-experiments-report.md](docs/plan/07-experiments-report.md). Actually *run* the full scenario matrix on both brokers, sweeping the spec values (A: device counts 100/1000/10000, BATCH; B: 30s outage; C: 50→5000 burst; D: across QoS 0/1/2 and acks 0/1/all), collect CSVs into `results/`, then write `docs/report.md` (tables, charts, MQTT-vs-Kafka analysis per scenario).

How to run a scenario (harness is done):
```bash
cp docker/.env.example docker/.env       # set BROKER_TYPE + BROKER_HOST/PORT to match the stack
# Scenario A (broker only):
( cd docker && docker compose --profile mqtt up -d )   # or --profile kafka
BROKER=mqtt benchmarks/scenario-a-massive-ingestion.sh   # DEVICE_COUNTS="100 1000 10000"
# Scenarios B/C/D (broker + app):
( cd docker && docker compose --profile mqtt --profile app up -d )
BROKER=mqtt benchmarks/scenario-b-connectivity-failure.sh   # OUTAGE_SEC=30
BROKER=mqtt benchmarks/scenario-c-burst-load.sh             # start ingestion at ~50 msg/s baseline
BROKER=mqtt benchmarks/scenario-d-alerting-latency.sh       # once per QOS_LEVEL / KAFKA_ACKS
```
Results → `results/<broker>/scenario-<x>/*.csv` (run outputs gitignored; structure kept). See [benchmarks/README.md](benchmarks/README.md) + [docs/notes/06-benchmark-harness.md](docs/notes/06-benchmark-harness.md).

**Test-harness gotchas (learned):** foreground `sleep` is blocked for the agent, and a no-sleep `curl` poll loop burns all iterations in ~1s — use a blocking `mosquitto_sub -C N` / `kafka-console-consumer --max-messages N` as a real-time pacer (run scenario scripts in background so their internal `sleep`s run). The `emqx/emqtt-bench` image's ENTRYPOINT is `emqtt_bench` (pass `pub`/`sub` as args); `sub` rejects `-L`.
Don't forget `cp docker/.env.example docker/.env` (gitignored) on a fresh checkout.

## ⚠️ Watch-outs / open questions

- **Kafka host listener:** `localhost:29092` advertised for host bench tools; in-network clients use `kafka:9092`. Verify host access works from WSL once the stack is up.
- **Network name:** compose `name: iots2` → bridge network is `iots2_iot-net`. Adjust the smoke-test `--network` flag if you rename the project.
- **TimescaleDB image tag** pinned to `2.17.2-pg16` — bump if unavailable.
- Per-iteration convention (DECISIONS / PLAN): after each iteration → summarize, propose commit msg, append CLAUDE.md entry, state verification.

## Conventions reminder

- Broker switch = `BROKER_TYPE` env (adapter) + `docker compose --profile <broker>` (infra). No code change.
- Commit style: conventional commits, `Co-Authored-By: Claude Opus 4.8` trailer.
