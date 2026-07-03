# Notes — presentation crib sheet

> Short, self-contained notes on the **important decisions** and **how things are
> implemented**, written so they can be re-read cold right before a presentation /
> defense. Plain English, one topic per file. This is *narrative* — the formal
> rationale lives in [../DECISIONS.md](../DECISIONS.md), the spec in
> [../REQUIREMENTS.md](../REQUIREMENTS.md), the roadmap in [../PLAN.md](../PLAN.md).

## How to use

Read top-to-bottom for the story; each note ends with a **"If asked"** block —
likely questions and the one-line answer. New notes get appended as iterations land.

## Index

| # | Note | One-liner |
|---|------|-----------|
| 01 | [The broker-neutral architecture](01-broker-abstraction.md) | Why MQTT↔Kafka is a one-flag switch with zero duplicated business logic |
| 02 | [Dev tooling: Kafka UI + MQTT Explorer](02-dev-tooling.md) | How we *see* what the brokers are doing during dev |
| 03 | [Ingestion service (device simulator)](03-ingestion-service.md) | The only publisher: profiles, rate model, burst, broker-neutral |
| 04 | [Storage service (subscriber → TimescaleDB)](04-storage-service.md) | The only DB writer: direct/batch, time-flush, ON CONFLICT, seq metrics |
| 05 | [Analytics service (FastAPI tumbling window)](05-analytics-service.md) | Python broker mirror: 10s window, alerting, dual latency (Scenario D) |
| 06 | [Benchmark harness](06-benchmark-harness.md) | Scenario A–D runners: bench tools vs simulator, parsers, CSV results |
| 07 | [Scenario B redesign](07-scenario-b-redesign.md) | Why we disconnect the *subscriber* (not the publisher), the keepalive gotcha, MQTT-vs-Kafka loss |
| 08 | [Optional dashboard](08-dashboard.md) | The read-only live monitor: scoped down, polling not socket.io, CORS, one-broker-at-a-time |

_(More notes appended per iteration: experiments + report.)_
