# Iteration 3 — Ingestion Service (NestJS)

**Goal:** A broker-agnostic device simulator / publisher (the only publisher in the system).

## Tasks

- Simulate `NUM_DEVICES` parallel devices; configurable `MESSAGES_PER_SECOND`.
- **Burst mode** (Scenario C): jump from baseline to `BURST_TARGET_RATE` abruptly for a documented duration.
- Data source via `DATA_SOURCE`:
  - `replay` → stream sampled rows from `data/iot_telemetry_data.csv` (`DATASET_PATH`), preserving the 3 device profiles (REQUIREMENTS §2.2).
  - `random` → realistic values within dataset ranges.
- Embed `seq` (per-device monotonic counter) + `sent_at_ms` (Date.now()) in every message.
- Publish via injected `BrokerAdapter` (QoS/acks from env).
- `Dockerfile` (multi-stage Node), wired into both compose profiles as a profiled service or run on demand.

## Verification

- `mosquitto_sub -t sensors/telemetry` / kafka console consumer shows messages with incrementing `seq` per device.
- Rate matches `MESSAGES_PER_SECOND`; burst visibly spikes to `BURST_TARGET_RATE`.
- Works unchanged under both `BROKER_TYPE=mqtt` and `kafka`.

## Commit

`feat(ingestion): NestJS simulator with burst mode + seq/sent_at_ms over broker adapter`
