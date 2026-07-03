# Benchmarks

Reproducible runners for the four experimental scenarios (REQUIREMENTS §7), writing
CSV results under `results/<broker>/scenario-<x>/`. Run them in **WSL2**.

## Load tools (mandated — no custom load generators for throughput)

| Path | Tool | How it's invoked |
|------|------|------------------|
| MQTT A/C throughput | **emqtt-bench** | `emqx/emqtt-bench` Docker image on `iots2_iot-net` |
| Kafka A throughput | **kafka-producer-perf-test.sh** | `docker exec iots-kafka …` (bundled) |
| B / C / D | the project's **NestJS simulator** | correlated messages (`seq`, `sent_at_ms`) for loss/latency |

A and C use bench tools for raw broker throughput; B and D need the simulator's
addressable, timestamped messages (DECISIONS §7.2). Resource usage is sampled with the
mandatory `docker stats` baseline (REQUIREMENTS §8.3) via `collect-docker-stats.sh`.

## Prerequisites per scenario

```bash
cp docker/.env.example docker/.env       # once; set BROKER_TYPE/HOST/PORT for the broker under test
# Scenario A — broker only:
docker compose --profile <broker> up -d
# Scenarios B/C/D — broker + app (ingestion, storage, analytics as containers):
docker compose --profile <broker> --profile app up -d
```

`BROKER` selects which stack the script targets (`mqtt` | `kafka`) and the `results/`
subfolder. It must match the running stack's `BROKER_TYPE`.

## Running

```bash
BROKER=mqtt  ./scenario-a-massive-ingestion.sh      # DEVICE_COUNTS, MSGS_PER_CLIENT, INTERVAL_MS, QOS
BROKER=kafka ./scenario-a-massive-ingestion.sh      # DEVICE_COUNTS→num-records, RECORD_SIZE, ACKS
BROKER=mqtt  ./scenario-b-matrix.sh                 # full grid (recommended): pub + subscriber variants
BROKER=mqtt  ./scenario-b-connectivity-failure.sh   # single run: DISCONNECT_TARGET (storage|ingestion), OUTAGE_SEC (30)
BROKER=mqtt  ./scenario-c-burst-load.sh             # BURST_SEC, WATCH_SEC  (start simulator at ~50 msg/s)
BROKER=mqtt  ./scenario-d-alerting-latency.sh       # WATCH_SEC  (run once per QoS/acks; low ALERT_THRESHOLD)
```

For **Scenario D** across delivery guarantees, set `QOS_LEVEL` (MQTT) or `KAFKA_ACKS`
(Kafka) in `docker/.env`, re-up the `app` stack, then run the script — its output is
labelled with the qos/acks so rows are comparable.

For **Scenario C**, start ingestion at the 50 msg/s baseline (e.g. `NUM_DEVICES=5`,
`MESSAGES_PER_SECOND=10`, `BURST_TARGET_RATE=5000`) so the burst is a true 50→5000 spike.

## What each script measures

- **A** — peak throughput (msg/s), loss % (sent vs received), CPU/RAM per container.
- **B** — messages lost (storage `seq` gaps during the outage), duplicates (`seq`
  repeats on reconnect), recovery time (reconnect → flow resumes). `scenario-b-matrix.sh`
  runs the full grid for one broker: a **publisher**-disconnect baseline (client buffering
  masks it → 0/0) plus **subscriber**-disconnect variants that exercise the broker — for
  MQTT it sweeps `clean_session` / QoS / `max_queued` (with `MQTT_KEEPALIVE_SEC=10` so the
  broker detects the dead client inside the outage), for Kafka it shows offset-resume at
  30 s and 90 s. It recreates the app stack per variant and restores `.env`/`mosquitto.conf`
  on exit. See [docs/notes/07-scenario-b-redesign.md](../docs/notes/07-scenario-b-redesign.md).
- **C** — peak backlog (storage `buffered`), loss, recovery time (backlog drains), plus
  a per-second timeseries CSV.
- **D** — transport latency (`/stats`, avg/max) and event-to-alert latency
  (percentiles across window `[LATENCY]` lines), per qos/acks.

## `lib/` parsers (pure, unit-testable)

| Parser | Input → Output |
|--------|----------------|
| `parse_emqtt.py` | emqtt-bench stdout → `label,kind,total,peak_rate,last_rate` |
| `parse_kafka_perf.py` | kafka-producer-perf-test stdout → records, rate, latency percentiles |
| `parse_docker_stats.py` | stats sample CSV → per-container cpu/mem avg+peak |
| `latency_stats.py` | numbers on stdin → `min,avg,p50,p95,p99,max` |

See [docs/notes/06-benchmark-harness.md](../docs/notes/06-benchmark-harness.md) for the
design rationale and the test-harness gotchas.
