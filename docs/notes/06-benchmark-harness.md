# 06 — Benchmark harness

The reproducible runners that produce the numbers for the report. Four scenario scripts
+ a resource sampler + pure parsers, all writing CSV under `results/<broker>/scenario-<x>/`.

## The load-tool split (and why)

The spec forbids custom load generators **for throughput testing**, but also requires a
device simulator. They serve different goals, so we split by scenario (DECISIONS §7.2):

- **A & C (raw throughput)** → mandated bench tools: **emqtt-bench** (run from the
  `emqx/emqtt-bench` Docker image on `iots2_iot-net`) and **kafka-producer-perf-test.sh**
  (bundled in the kafka container, via `docker exec`). These push the broker to its
  ceiling and self-report rate/latency.
- **B & D (loss / latency)** → our **NestJS simulator**, because these need *correlated*
  messages: per-device `seq` (so loss/dup is exact) and `sent_at_ms` (so latency is real).
  Bench tools can't embed a custom send timestamp or a per-device counter.

Resource cost is the mandatory `docker stats` baseline (REQUIREMENTS §8.3), sampled by
`collect-docker-stats.sh` into a CSV and aggregated to per-container avg/peak.

## How each scenario is measured (the clever bits)

- **A — massive ingestion.** MQTT: `emqtt-bench pub` (sender) + `emqtt-bench sub`
  (receiver) → throughput = peak pub rate, loss = (sent−received)/sent. Kafka:
  `kafka-producer-perf-test` for throughput+latency, a console consumer counts received.
- **B — connectivity failure.** We don't need to instrument the network: the storage
  service's **`seq` tracker does it for us** (gap = lost, repeat = redelivered). Run in two
  variants via `scenario-b-matrix.sh`: disconnecting the **publisher** (client buffering
  masks it → 0/0 on both) and disconnecting the **subscriber** (exercises the broker —
  MQTT loses under clean-session/QoS 0/queue-overflow, Kafka resumes from its offset).
  The subscriber variant needs a lowered MQTT keepalive (`MQTT_KEEPALIVE_SEC=10`) so a 30 s
  outage actually tears the session down. Full rationale in
  [07-scenario-b-redesign.md](07-scenario-b-redesign.md). Recovery = reconnect → received
  count rises again.
- **C — burst.** Fire `POST /burst?durationSec=N` on the simulator (50 → 5000 msg/s) and
  sample storage `/stats` every second: peak `buffered` = backlog, `seq` gap delta =
  loss, time for `buffered` to drain = recovery. Emits a per-second timeseries CSV.
- **D — alerting latency.** Read transport latency (avg/max) from analytics `/stats`, and
  event-to-alert latency percentiles from the per-window `[LATENCY]` lines the analytics
  service prints. Run once per `QOS_LEVEL` / `KAFKA_ACKS` (labelled in the output) to
  compare delivery guarantees.

## Parsers are pure and unit-tested

`lib/*.py` take tool stdout / CSV on stdin and emit one CSV row — no side effects, so
they're trivially checkable against a hand-verified sample (and were):

- `parse_emqtt.py` — `Ns pub total=… rate=…/sec` → total + peak rate (pub or recv).
- `parse_kafka_perf.py` — the perf-test summary line → records, rate, avg/max/p50/p95/p99.
- `parse_docker_stats.py` — sample CSV → per-container cpu/mem avg+peak (handles
  MiB/GiB→MB unit conversion).
- `latency_stats.py` — numbers in → min/avg/p50/p95/p99/max (nearest-rank percentiles).

## Test-harness gotchas worth remembering

- **emqtt-bench Docker image has `emqtt_bench` as its ENTRYPOINT** — pass `pub …` /
  `sub …` as args, *not* `emqtt_bench pub …` (that double-invokes and just prints usage).
- A subscriber/consumer with a fixed `-L`/`--max-messages` exits early once it has them,
  but **must have a `timeout`** in case of loss (otherwise it hangs forever).
- (Dev note) When driving these from an automated agent: a no-`sleep` `curl` poll loop
  burns all iterations in ~1s — use a blocking `mosquitto_sub -C N` /
  `kafka-console-consumer --max-messages N` as a natural real-time pacer.

## Verified (2026-06-03, WSL2)

- All four parsers produce hand-checked output on sample inputs.
- `scenario-a` runs end-to-end on **both** brokers (emqtt-bench pub/sub for MQTT,
  kafka-producer-perf-test + consumer for Kafka), writing `summary-*.csv` +
  `resources-*-agg.csv` to the right `results/` folder.
- `collect-docker-stats.sh` samples the iots-* containers into CSV; aggregation works.
- B/C/D scripts pass `bash -n` and are wired to the service `/stats` + control ports;
  they get exercised in full in Iteration 7 (experiments + report).

## If asked

- *"Why bench tools for A/C but your simulator for B/D?"* → Throughput wants a raw
  firehose (and the spec mandates the tools); loss/latency want correlated messages with
  `seq` + `sent_at_ms`, which only the simulator emits.
- *"How is loss measured without touching the network in B?"* → The per-device `seq`
  gap recorded by storage *is* the loss; duplicates are `seq` repeats.
- *"Where do the results go?"* → `results/<broker>/scenario-<x>/` as CSV, one set per run
  (timestamped), ready for the report.
