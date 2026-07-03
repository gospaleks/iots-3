# Implementation Plan — IoTS Project 2 (MQTT vs Kafka)

> **Overview / index.** This file is the high-level map. Each iteration has a detailed file in [`plan/`](plan/). The "what" lives in [REQUIREMENTS.md](REQUIREMENTS.md), the "why" in [DECISIONS.md](DECISIONS.md). Running change log is in [../CLAUDE.md](../CLAUDE.md).

## Goal

A containerized, event-driven IoT system that **benchmarks MQTT (Mosquitto) vs Kafka (KRaft)** across four scenarios, with **zero code duplication** via the adapter pattern. Three services (NestJS ingestion, NestJS storage, FastAPI analytics) talk only through the broker; `BROKER_TYPE` env var picks the adapter; Docker Compose **profiles** pick the broker stack.

## Confirmed decisions

| Area | Choice | Reference |
|------|--------|-----------|
| Code reuse | One codebase/service + `BrokerAdapter` + runtime `BROKER_TYPE` | DECISIONS §7.1 |
| Repo structure | Unified `services/` + `docker/` with compose profiles | REQUIREMENTS §11 |
| Load generation | Bench tools for throughput (A, C); simulator for B, D | DECISIONS §7.2 |
| Measurement | `seq` + `sent_at_ms` in payload; dual latency (transport + event-to-alert) | DECISIONS §7.3 |
| Database | TimescaleDB hypertable, PK `(ts, device)` | DECISIONS §7.4 |
| Batch flush | Size OR time (`BATCH_SIZE` / `FLUSH_INTERVAL_MS`) | DECISIONS §7.5 |
| Dev env | WSL2 + Docker Desktop | DECISIONS §7.5 |

## Iteration map

| # | Iteration | File | Outcome |
|---|-----------|------|---------|
| 0 | Docs reorg, scaffolding, project reference | [00-scaffolding.md](plan/00-scaffolding.md) | docs in `docs/`, contracts, CLAUDE.md, README, dir skeleton |
| 1 | Infrastructure (DB + brokers + profiles) | [01-infrastructure.md](plan/01-infrastructure.md) | TimescaleDB + Mosquitto + Kafka up via profiles |
| 2 | Shared NestJS libs (adapter + contracts) | [02-shared-libs.md](plan/02-shared-libs.md) | `BrokerAdapter`, both adapters, DI factory |
| 3 | Ingestion Service (NestJS) | [03-ingestion.md](plan/03-ingestion.md) | Device simulator, burst mode, seq/sent_at_ms |
| 4 | Storage Service (NestJS) | [04-storage.md](plan/04-storage.md) | Subscriber + TimescaleDB writer, direct/batch |
| 5 | Analytics Service (FastAPI) | [05-analytics.md](plan/05-analytics.md) | Tumbling window, alerts, dual latency |
| 6 | Benchmark harness | [06-benchmarks.md](plan/06-benchmarks.md) | Scenario A–D runners + docker stats + parsers |
| 7 | Experiments + report | [07-experiments-report.md](plan/07-experiments-report.md) | Filled performance table + Q1/Q2 answers |
| 8 | Dashboard (optional, last) | [08-dashboard.md](plan/08-dashboard.md) | Live metrics + scenario control UI |

## Working convention (every iteration)

1. **Summarize** deliverables.
2. **Propose a commit message** (conventional commits; commit only when asked).
3. **Append a dated entry to [../CLAUDE.md](../CLAUDE.md)** referencing the relevant docs/sections.
4. State the **verification** performed/expected.

## Cross-cutting contracts

- **Payload:** dataset fields + `seq` + `sent_at_ms` — see [../shared/message-contract.md](../shared/message-contract.md).
- **Topics:** MQTT `sensors/telemetry`, Kafka `sensor-telemetry`.
- **Fan-out:** Kafka storage = consumer group A, analytics = group B; MQTT both subscribe to the same topic.
- **Switching brokers:** `BROKER_TYPE` (adapters) + `docker compose --profile <broker>` (infra). No code change.

## Overall verification

- **Unit:** adapter factory selection; window math; batch flush triggers.
- **Integration (per profile):** ingestion → broker → storage rows; ingestion → broker → analytics windows/alerts.
- **Scenario E2E:** A (throughput/loss + stats), B (loss/recovery/dups), C (backlog/recovery), D (latency percentiles, both metrics) → CSV under `results/`.
- **DB:** row counts, hypertable chunks present, no PK violations.
- **Sanity:** benchmarks run without the dashboard; `--profile` switch needs no code change.
