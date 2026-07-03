# Iteration 5 — Analytics Service (FastAPI)

**Goal:** Real-time stream processing with a 10s tumbling window, alerting, and latency capture.

## Tasks

- Python broker adapter: `asyncio-mqtt` / `aiokafka`, switched by `BROKER_TYPE` (mirrors the NestJS `BrokerAdapter` contract; analytics = Kafka consumer group B).
- **Tumbling window** (`WINDOW_SIZE_SEC`, default 10s, fixed/non-overlapping): accumulate messages, compute `avg_temp`, `avg_humidity`, `avg_co` per window.
- **Alerting** (`ALERT_THRESHOLD`, default 50°F): log `[ALERT]` if `avg_temp > threshold`, else `[INFO]` — format per REQUIREMENTS §5.3.
- **Latency** (Scenario D), record both:
  - transport = `receive_at_ms − sent_at_ms` per message,
  - event-to-alert = `alert_log_ms − sent_at_ms` per alert.
  Emit to a parseable log/CSV line.
- `Dockerfile` (slim Python), `requirements.txt` (`fastapi`, `asyncio-mqtt`, `aiokafka`, ...).

## Verification

- Window summary logged every `WINDOW_SIZE_SEC`.
- `[ALERT]` fires when avg_temp exceeds threshold; `[INFO]` otherwise.
- Latency lines parse; transport < event-to-alert as expected.
- Works under both `BROKER_TYPE=mqtt` and `kafka`.

## Commit

`feat(analytics): FastAPI tumbling window + alerting + dual latency capture`
