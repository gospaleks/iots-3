# Iteration 4 — Storage Service (NestJS)

**Goal:** Subscribe to the broker and persist to TimescaleDB; the only writer to the DB.

## Tasks

- Subscribe via injected `BrokerAdapter`; parse JSON into `SensorMessage`.
- Insert into `sensor_data` (convert `ts` epoch float → `TIMESTAMPTZ`).
- **Write modes** (`WRITE_MODE`):
  - `DIRECT` — one INSERT per message (dev default).
  - `BATCH` — buffer, flush on `BATCH_SIZE` **OR** `FLUSH_INTERVAL_MS` (whichever first), single multi-row INSERT per flush.
- TypeORM with `synchronize: false` (schema owned by `db/init.sql`).
- Metrics: count stored rows; detect `seq` gaps/duplicates per device → feeds loss/duplicate metrics for Scenarios A/B/C.
- `Dockerfile`.

## Design notes

- Time-based flush is mandatory (DECISIONS §7.5) — prevents low-rate stalls and bounds loss-on-crash.
- Idempotency: with PK `(ts, device)`, duplicate `(ts, device)` rows conflict — decide `ON CONFLICT DO NOTHING` vs counting duplicates (for QoS1/acks1 duplicate analysis, prefer logging the conflict count).

## Verification

- Rows appear in `sensor_data`; `SELECT count(*)` tracks sent.
- BATCH writes in chunks of `BATCH_SIZE`; at low rate the time-flush fires within `FLUSH_INTERVAL_MS`.
- `seq`-gap counter is sane under normal flow (0 gaps).

## Commit

`feat(storage): NestJS subscriber + TimescaleDB writer, direct/batch (size+time flush)`
