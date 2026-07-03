# Iteration 6 — Benchmark harness

**Goal:** Reproducible scenario runners producing CSV results, using the mandated bench tools (run in WSL2 / containerized).

## Tasks

- `benchmarks/scenario-a-massive-ingestion.sh` — device counts 100/1000/10000, BATCH storage; drive load with emqtt-bench / kafka-producer-perf-test; capture throughput, loss, CPU/RAM.
- `benchmarks/scenario-b-connectivity-failure.sh` — `docker network disconnect` ingestion, wait 30s, reconnect; measure messages lost, recovery time, duplicates (MQTT persistent session vs Kafka offset resume).
- `benchmarks/scenario-c-burst-load.sh` — baseline 50 → peak 5000 msg/s abrupt; measure backlog, backpressure, recovery time, loss.
- `benchmarks/scenario-d-alerting-latency.sh` — drive the NestJS simulator across QoS/acks; collect transport + event-to-alert latency; compute min/avg/p95/max.
- `benchmarks/collect-docker-stats.sh` — sample `docker stats` → CSV (CPU%, MemUsage, NetIO) over a run.
- `benchmarks/lib/` — parsers: logs → loss %, throughput, latency percentiles (p50/p95/p99).

## Notes

- A/C use bench tools (raw throughput); B/D use the simulator (correlated messages, timestamps). See DECISIONS §7.2.
- Results land under `results/<broker>/scenario-<x>/`.

## Verification

- Each script runs end-to-end on both profiles and writes CSV to the right `results/` folder.
- Parser output matches a hand-checked sample.

## Commit

`feat(benchmarks): scenario A–D runners + docker stats + result parsers`
