# 04 — Storage service (subscriber → TimescaleDB)

The **only writer** to the database. A NestJS app that subscribes to the broker (via
the injected `SubscriberAdapter` — same broker-neutral pattern as ingestion) and
persists every message to the `sensor_data` hypertable.

## Write modes — and why the time-flush is mandatory

`WRITE_MODE` switches the writer:

- **`DIRECT`** — one `INSERT` per message. Simple; dev default.
- **`BATCH`** — buffer messages and flush on **`BATCH_SIZE` OR `FLUSH_INTERVAL_MS`**,
  whichever comes first, as a single multi-row `INSERT`. This is what you use for the
  high-load Scenarios A and C, so the DB I/O doesn't become the bottleneck and skew the
  benchmark away from the broker.

The **time trigger is not optional** (DECISIONS §7.5): with size-only batching, a
low-rate stream (Scenario D, idle gaps) would sit un-flushed indefinitely, and the
number of buffered-but-unwritten rows on a crash would be unbounded. The timer bounds
both. Verified directly: after the publisher stops with a partial buffer (<`BATCH_SIZE`),
the timer flushes it within `FLUSH_INTERVAL_MS` — we don't wait to reach the size.

## Idempotency — the PK conflict is a feature, not a bug

The table PK is `(ts, device)`. Replay can legitimately re-emit a `(ts, device)` pair
(devices cycle their sampled rows), so inserts use:

```sql
INSERT INTO sensor_data (...) VALUES (...), (...)
ON CONFLICT (ts, device) DO NOTHING
RETURNING 1
```

`RETURNING 1` yields one row per **actually-inserted** row, so we get the exact inserted
count for free → `conflicts = attempted − inserted`. This makes the writer idempotent
and gives a clean duplicate-at-DB metric. In a real run the arithmetic always closes:

```
received = stored + conflicts + buffered     (and  DB row count == stored)
```

> Why raw parameterized SQL instead of `repository.save()`? Exact `ON CONFLICT` counts
> and one round-trip per batch. We still use **TypeORM** (`DataSource`, `synchronize:false`)
> for the connection/pool and the documented entity — the schema is owned by
> `docker/db/init.sql` because TypeORM can't create hypertables.

## Metrics it exposes (`GET /stats` on `STORAGE_PORT` 3002)

- **writer**: writeMode, received, stored, conflicts, flushes, errors, buffered, lastFlushSize
- **seq**: per-device integrity from the `seq` counter — `missing` (gap sizes summed),
  `gaps`, `duplicates`, `outOfOrder`. This is the *real* loss/duplicate signal for the
  benchmark (independent of DB conflicts).
- **transportLatencyMs**: `receivedAtMs − sent_at_ms` (count / avg / max).

## The Kafka "subscribe before the topic exists" fix

A subscriber can start **before** any producer has created the topic. kafkajs then
fails the subscribe with `UNKNOWN_TOPIC_OR_PARTITION` and crashes. The fix lives in the
shared `KafkaAdapter.subscribe`: it first `admin.createTopics({ waitForLeaders: true })`
(idempotent — no-op if the topic exists) so the topic+leader are guaranteed before the
consumer subscribes. MQTT has no such concept. This is why storage can be brought up
first, standalone, and just wait for data.

## Verified (2026-06-03, WSL2)

- **BATCH (MQTT)**, 50 devices @ ~500 msg/s: `received == stored + conflicts + buffered`,
  DB count == stored, flush chunks of 500, **0 gaps / 0 duplicates / 0 out-of-order**,
  transport latency avg **~1.6 ms** (max 9 ms).
- **Time-flush**: partial buffer (<500) drained to the DB on the timer after the
  publisher stopped.
- **DIRECT (MQTT)**: `flushes == 0`, stored == received == DB count.
- **`ON CONFLICT`**: after replay buckets wrapped, ~3.9k duplicate `(ts, device)` rows
  were skipped and counted as `conflicts`, arithmetic closed exactly.
- **Kafka**: storage started *subscriber-first* (no topic yet) → no crash thanks to the
  ensure-topic fix; same binary, `BROKER_TYPE=kafka`, clean integrity. Transport latency
  avg **~16 ms** — markedly higher than MQTT locally (a real signal for the report).
- Image builds (multi-stage, context = `services/`); wired into compose under `app` with
  `depends_on: timescaledb (healthy)`.

## If asked

- *"Why ON CONFLICT DO NOTHING and not upsert?"* → A duplicate delivery shouldn't change
  stored data; we'd rather *count* it. Sensor readings are immutable per `(ts, device)`.
- *"DB conflicts vs seq duplicates — same thing?"* → No. `seq` duplicates = the broker
  delivered the same message twice (QoS/acks effect). DB conflicts = the same
  `(ts, device)` arrived (replay cycling). Different signals; we track both.
- *"Is the DB a bottleneck in A/C?"* → That's exactly why BATCH + multi-row INSERT exists;
  a single flush writes up to `BATCH_SIZE` rows in one round-trip.
- *"Why is Kafka latency higher than MQTT here?"* → Kafka batches/commits for throughput
  and durability; MQTT QoS1 is a lighter per-message hop. Expected; we quantify it in D.
