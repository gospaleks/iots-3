# 03 — Ingestion service (the device simulator)

The system's **only publisher**. A NestJS app that pretends to be a fleet of IoT
devices and publishes sensor messages through the broker adapter — so it's
broker-agnostic by construction (it injects `PublisherAdapter`, never MQTT/Kafka
directly; see [01-broker-abstraction.md](01-broker-abstraction.md)).

## What it does

- Simulates `NUM_DEVICES` devices in parallel, each with its own monotonic `seq`.
- Two data sources, picked by `DATA_SOURCE`:
  - **`replay`** — streams a sample of the real dataset CSV, bucketed by the three
    device profiles (cool/humid, variable, warm/dry). Each device replays its
    profile's rows cyclically, so the real environmental character is preserved.
  - **`random`** — synthesises values within each profile's dataset-derived ranges.
- Stamps every message with `seq` (per-device counter) and `sent_at_ms` (`Date.now()`),
  on top of the dataset event time `ts`. (`ts` ≠ `sent_at_ms` — see the contract.)
- **Burst mode** for Scenario C: jumps the whole fleet to a high total rate for a
  fixed window, then snaps back.

## How devices map to profiles

There are only 3 real device MACs but `NUM_DEVICES` can be 100. Devices are assigned a
profile round-robin (`i % 3`). When `NUM_DEVICES ≤ 3` the real MACs are used 1:1;
otherwise the id is suffixed with the index (`00:0f:00:70:91:0a-37`) so it's unique but
you can still see which profile it came from. Unique ids matter for the DB PK
`(ts, device)` downstream.

## The rate model (important — and a deliberate choice)

`MESSAGES_PER_SECOND` is **per device**; `BURST_TARGET_RATE` is a **total** fleet rate.
So:

- baseline total = `NUM_DEVICES × MESSAGES_PER_SECOND` (default 100×10 = 1000 msg/s)
- during a burst, total = `BURST_TARGET_RATE` (default 5000 msg/s)

The simulator drives this with a fixed **100 ms scheduler tick**: each tick it computes
how many messages this tick owes (`rate × 0.1`, with a fractional accumulator so the
average rate is exact), and round-robins across devices to publish them. Round-robin is
what keeps each device's `seq` strictly increasing in order.

> Why a tick instead of a timer per message? At 5000 msg/s a per-message timer fires
> every 0.2 ms — too fine for `setInterval`. Batching per 100 ms tick is precise and
> cheap. Publishes are fire-and-forget with error counting so a slow broker creates
> backpressure (`inFlight`) rather than blocking the scheduler.

## Control surface (so benchmarks can drive it)

A tiny HTTP API on `INGESTION_PORT` (3001):

| Method/route | Purpose |
|--------------|---------|
| `GET /health` | liveness + uptime |
| `GET /stats`  | published, errors, current rate, inFlight, bursting, … |
| `POST /burst?durationSec=30` | trigger a burst (Scenario C scripts curl this) |

## Run it

From the host (dev), against a running broker on localhost:
```bash
cd services && npm run build
BROKER_TYPE=mqtt  BROKER_HOST=localhost BROKER_PORT=1883  NUM_DEVICES=3 \
  DATASET_PATH=$PWD/../data/iot_telemetry_data.csv npm run start:ingestion
# watch:  curl localhost:3001/stats   |   trigger: curl -XPOST 'localhost:3001/burst?durationSec=10'
```
In Docker (wired into compose under the **`app`** profile):
```bash
# .env selects the broker; pair the app profile with the broker profile
docker compose --profile mqtt  --profile app up -d   # (.env BROKER_HOST=mosquitto:1883)
docker compose --profile kafka --profile app up -d   # (.env BROKER_HOST=kafka  BROKER_PORT=9092)
```

## Verified (2026-06-02, WSL2)

- **MQTT** (3 devices, replay): messages arrive on `sensors/telemetry` with `seq`
  incrementing per device, realistic per-profile values, current `sent_at_ms`.
- **Burst**: `/burst` jumped the rate 6 → 5000 msg/s (~4.2k published in ~1 s, 0 errors),
  then reverted automatically.
- **Kafka**: the *same binary* with `BROKER_TYPE=kafka` publishes to `sensor-telemetry`
  identically — the one-flag switch, proven on the real publisher.
- **Container**: image builds (multi-stage, context = `services/`), runs on `iot-net`,
  loads the dataset from a mounted volume, publishes in-network. Graceful SIGTERM
  shutdown disconnects the broker (`enableShutdownHooks`).

## If asked

- *"Per-device or total rate?"* → MPS is per device; burst is total. Documented so the
  defaults (1000 baseline / 5000 burst) make sense.
- *"Why only 3 MACs but 100 devices?"* → 3 real profiles, fanned out to N unique ids,
  preserving the environmental character.
- *"How do you get an exact rate?"* → 100 ms tick + fractional accumulator; round-robin
  keeps `seq` ordered.
- *"What proves it's broker-neutral?"* → identical message output under MQTT and Kafka
  from the same build, switching only `BROKER_TYPE`.
