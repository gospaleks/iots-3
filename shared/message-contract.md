# Message Contract

> The canonical broker payload and topic conventions shared by all three services. NestJS services consume the typed DTO from `services/libs/contracts`; the FastAPI service mirrors this shape. JSON only — no Avro/Protobuf (DECISIONS §6).

## Payload (JSON)

```json
{
  "ts": 1594419195.292461,
  "device": "00:0f:00:70:91:0a",
  "co": 0.006104480269226063,
  "humidity": 55.099998474121094,
  "light": true,
  "lpg": 0.008895956948783413,
  "motion": false,
  "smoke": 0.023978358312270912,
  "temp": 31.799999237060547,
  "seq": 12345,
  "sent_at_ms": 1717327200123
}
```

### Field semantics

| Field        | Meaning                                                                 |
|--------------|-------------------------------------------------------------------------|
| `ts`         | Dataset **event** time (epoch seconds). Stored as `TIMESTAMPTZ`.        |
| `device`     | Source device MAC (one of the three in `dataset_info.md`).              |
| `co`…`temp`  | Sensor readings (see `dataset_info.md`).                                |
| `seq`        | **Per-device** monotonic counter. Gaps ⇒ loss; repeats ⇒ duplicates.   |
| `sent_at_ms` | Wall-clock send time (epoch ms). **Not** `ts`. Basis for latency.      |

> `ts` is *event* time (from the dataset). `sent_at_ms` is *send* time (now, when the simulator publishes). They are different on purpose — never conflate them.

## Topics

| Broker | Topic              |
|--------|--------------------|
| MQTT   | `sensors/telemetry`|
| Kafka  | `sensor-telemetry` |

Both are configurable via the `TOPIC` env var.

## Delivery / fan-out

- **Ingestion** is the only publisher.
- **Storage** and **Analytics** are subscribers only.
- **Kafka:** Storage = consumer group A, Analytics = consumer group B (each group receives the full stream).
- **MQTT:** both subscribe to the same topic (standard fan-out; single instance each, so no shared subscriptions).

## Reliability knobs

| Broker | Knob        | Values            | Env var     |
|--------|-------------|-------------------|-------------|
| MQTT   | QoS         | 0, 1, 2           | `QOS_LEVEL` |
| Kafka  | producer acks | 0, 1, all       | `KAFKA_ACKS`|

## Latency metrics (Scenario D)

| Metric              | Formula                       |
|---------------------|-------------------------------|
| Transport           | `receive_at_ms − sent_at_ms`  |
| Event-to-alert      | `alert_log_ms − sent_at_ms`   |
