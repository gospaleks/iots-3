# Message Contract

> The canonical broker payload and topic conventions for the **raw telemetry** stream, shared by all services. NestJS services consume the typed DTO from `services/libs/contracts`; the FastAPI service mirrors this shape. JSON only. Project 3 is MQTT-only.

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

| Purpose | Topic / Channel | Kind | Producer | Consumers |
|---------|-----------------|------|----------|-----------|
| Raw telemetry | `sensors/telemetry` (**`RAW_TOPIC`**) | MQTT | Ingestion | Storage, eKuiper |
| CEP events | `sensors/events` (**`EVENTS_TOPIC`**) | MQTT | eKuiper sink | Analytics |
| Prediction request | `POST /predict` | REST | Analytics | MaaS |
| Live event relay | Socket.IO `event` | WS | Analytics | Web app |
| Enriched alert | Socket.IO `alert` | WS | Analytics | Web app |
| Snapshots | `GET /api/*` | REST | Analytics | Web app |

The raw topic name is configurable via the `TOPIC` env var, the events topic via `EVENTS_TOPIC`.
**The browser never speaks MQTT** — the web app consumes live data over Socket.IO from Analytics
and pulls snapshots over REST (D11). There is no `ui/alerts` MQTT topic.

## Downstream contracts (P3)

The raw payload above is produced by Ingestion. eKuiper aggregates it into *tagged window
events*; Analytics enriches events-of-interest with a MaaS forecast and pushes them to the web
app. These three shapes are frozen here (from `IMPLEMENTATION_PLAN.md` §2.2–§2.4).

### `sensors/events` payload (eKuiper → Analytics)

Every message is a single JSON object tagged by `event_type` (`sendSingle: true` on the sink).

```json
{
  "event_type": "WINDOW_METRICS",        // or SUSTAINED_HIGH_TEMP | HIGH_CO | HEAT_DRYING
  "device": "1c:bf:ce:15:ec:4d",
  "window_start": 1594419190.0,
  "window_end":   1594419200.0,
  "avg_temp": 26.1, "max_temp": 27.4, "min_temp": 25.0,
  "avg_humidity": 41.2, "avg_co": 0.0071, "avg_lpg": 0.0090, "avg_smoke": 0.0243,
  "sample_count": 96
}
```

- **`WINDOW_METRICS`** — the rollup rule; emitted **every window** (no `HAVING`). Feeds the
  forecast-history buffer **and** the predicted-vs-actual chart.
- **`HIGH_CO` / `SUSTAINED_HIGH_TEMP` / `HEAT_DRYING`** — event-of-interest rules; carry the same
  aggregate fields so Analytics can act without re-buffering.

### Enriched alert payload (Analytics → web app, Socket.IO `alert`)

```json
{
  "ts": 1594419200.5,
  "device": "1c:bf:ce:15:ec:4d",
  "event_type": "SUSTAINED_HIGH_TEMP",
  "actual_avg_temp": 26.1,
  "forecast_next_avg_temp": 26.9,
  "forecast_available": true,
  "model_version": "1.0",
  "message": "[PREDICTIVE ALERT] device=1c:bf:ce:15:ec:4d | eKuiper=SUSTAINED_HIGH_TEMP (avg 26.1°C) | MaaS=next 26.9°C | pre-emptive"
}
```

### MaaS REST contract

`POST /predict` request — the last `LAG_WINDOWS` window aggregates, **oldest → newest**:

```json
{
  "device": "1c:bf:ce:15:ec:4d",
  "history": [
    {"avg_temp": 25.1, "avg_humidity": 42.0, "avg_co": 0.0060, "max_temp": 26.0},
    {"avg_temp": 25.6, "avg_humidity": 41.5, "avg_co": 0.0064, "max_temp": 26.4},
    {"avg_temp": 25.9, "avg_humidity": 41.1, "avg_co": 0.0068, "max_temp": 26.9},
    {"avg_temp": 26.1, "avg_humidity": 41.2, "avg_co": 0.0071, "max_temp": 27.4}
  ]
}
```

`POST /predict` response:

```json
{ "prediction": 26.9, "target": "next_window_avg_temp", "unit": "C",
  "device": "1c:bf:ce:15:ec:4d", "model_version": "1.0" }
```

`GET /health` → `{ "status": "ok" }`
`GET /model/info` → `{ "task", "algorithm", "features", "lag_windows", "window_size_sec", "metrics": {mae,rmse,r2}, "trained_at", "version" }`

> **Parity (never break silently):** `LAG_WINDOWS` (history length) must match across `train.py`,
> MaaS `features.py`, and the Analytics buffer; `WINDOW_SIZE` must match between eKuiper provision
> and `train.py` windowing; temperature stays °C end-to-end. See `shared/thresholds.md` and
> `IMPLEMENTATION_PLAN.md` §2.5.

## Delivery / fan-out

- **Ingestion** is the only publisher of raw telemetry.
- **Storage** and **eKuiper** subscribe to `sensors/telemetry` (standard MQTT fan-out; single
  instance each, so no shared subscriptions).
- **Analytics** (after the P3 rewire) subscribes to `sensors/events`, not the raw topic.

## Reliability knobs

| Knob | Values | Env var     |
|------|--------|-------------|
| MQTT QoS | 0, 1, 2 | `QOS_LEVEL` |

## Latency metrics

| Metric              | Formula                       |
|---------------------|-------------------------------|
| Transport           | `receive_at_ms − sent_at_ms`  |
| Event-to-alert      | `alert_log_ms − sent_at_ms`   |
