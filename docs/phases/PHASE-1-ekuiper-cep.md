# PHASE 1 — eKuiper CEP (stream + rollup + threshold rule)

> Part of `IMPLEMENTATION_PLAN.md`. Read `SESSION_STATE.md` first.

## 0. Context to load first
- Read: `IMPLEMENTATION_PLAN.md` §1, §2.1–§2.2, §2.5, §3; `docs/IoTS-3-EXPLAINED.md` §4 (whole).
- Depends on: **Phase 0 DONE** (base runs, contracts + env keys committed).
- Invariants: `RAW_TOPIC=sensors/telemetry`; eKuiper out=`sensors/events`; window **size** must
  equal the value `train.py` will use (`WINDOW_SIZE`, default 10s); provision via REST only.

## 1. Goal
Stand up eKuiper as a container, define the `sensor_stream` over the raw topic, and provision
**two** rules to `sensors/events`: a continuous **rollup** (`WINDOW_METRICS`, feeds forecasting)
and one **threshold** event (`HIGH_CO`). The window clause is **built from env** at provision
time so the type is switchable without editing SQL. A fresh `docker compose up` must yield a
working CEP layer with zero manual UI steps.

## 2. Entry criteria
- Phase 0 acceptance passed; `docker/.env` has the `WINDOW_*` and threshold keys.
- Pick and **pin** a current `lfedge/ekuiper` 2.x `-slim` tag (verify at build time; do not use `latest`).

## 3. Steps

### 3.1 Compose service
Add to `docker/docker-compose.yml` (profile `mqtt` or a new `cep` profile):
```yaml
  ekuiper:
    image: lfedge/ekuiper:2.2-slim        # PIN a verified current tag
    container_name: ekuiper
    environment:
      MQTT_SOURCE__DEFAULT__SERVER: "tcp://mosquitto:1883"
      KUIPER__BASIC__CONSOLELOG: "true"
    ports: ["9081:9081"]                  # REST management API
    depends_on: [mosquitto]
  ekuiper-provision:                       # init-style one-shot; provisions then exits
    image: curlimages/curl:8.8.0
    depends_on: [ekuiper]
    volumes: ["../ekuiper:/ekuiper:ro"]
    entrypoint: ["/bin/sh", "/ekuiper/provision.sh"]
    environment:
      EKUIPER_URL: "http://ekuiper:9081"
      RAW_TOPIC: "sensors/telemetry"
      EVENTS_TOPIC: "sensors/events"
      WINDOW_TYPE: "${WINDOW_TYPE}"
      WINDOW_UNIT: "${WINDOW_UNIT}"
      WINDOW_SIZE: "${WINDOW_SIZE}"
      WINDOW_STEP: "${WINDOW_STEP}"
      CO_HIGH: "${CO_HIGH}"
```
(Optional dev-only: `emqx/ekuiper-manager` on 9082 for click-around inspection — never the source of truth.)

### 3.2 Stream definition (`ekuiper/streams/sensor_stream.json`)
```json
{ "sql": "CREATE STREAM sensor_stream (ts BIGINT, device STRING, co FLOAT, humidity FLOAT, light BOOLEAN, lpg FLOAT, motion BOOLEAN, smoke FLOAT, temp FLOAT, seq BIGINT, sent_at_ms BIGINT) WITH (DATASOURCE=\"sensors/telemetry\", FORMAT=\"JSON\")" }
```

### 3.3 Window templating (the D6 mechanism)
`provision.sh` builds the `GROUP BY` window clause from env. eKuiper v2 signatures (verified):
| type | clause |
|------|--------|
| tumbling | `TUMBLINGWINDOW(UNIT, SIZE)` |
| hopping | `HOPPINGWINDOW(UNIT, SIZE, STEP)` |
| sliding | `SLIDINGWINDOW(UNIT, SIZE[, STEP])` |
| session | `SESSIONWINDOW(UNIT, SIZE, STEP)` |
| count | `COUNTWINDOW(SIZE[, STEP])` (no UNIT) |

Sketch:
```sh
case "$WINDOW_TYPE" in
  tumbling) WIN="TUMBLINGWINDOW($WINDOW_UNIT, $WINDOW_SIZE)";;
  hopping)  WIN="HOPPINGWINDOW($WINDOW_UNIT, $WINDOW_SIZE, $WINDOW_STEP)";;
  sliding)  WIN="SLIDINGWINDOW($WINDOW_UNIT, $WINDOW_SIZE${WINDOW_STEP:+, $WINDOW_STEP})";;
  session)  WIN="SESSIONWINDOW($WINDOW_UNIT, $WINDOW_SIZE, $WINDOW_STEP)";;
  count)    WIN="COUNTWINDOW($WINDOW_SIZE${WINDOW_STEP:+, $WINDOW_STEP})";;
esac
```

### 3.4 Rules
**ROLLUP — `WINDOW_METRICS` (no HAVING, emits every window):**
```sql
SELECT device,
       AVG(temp) AS avg_temp, MAX(temp) AS max_temp, MIN(temp) AS min_temp,
       AVG(humidity) AS avg_humidity, AVG(co) AS avg_co,
       AVG(lpg) AS avg_lpg, AVG(smoke) AS avg_smoke,
       COUNT(*) AS sample_count,
       window_start() AS window_start, window_end() AS window_end,
       'WINDOW_METRICS' AS event_type
FROM sensor_stream
GROUP BY device, <WIN>
```
**THRESHOLD — `HIGH_CO` (per-message filter, no window):**
```sql
SELECT device, co, temp, ts, 'HIGH_CO' AS event_type
FROM sensor_stream
WHERE co > <CO_HIGH>
```
Each rule POSTed with an MQTT sink:
```json
{ "id": "window_metrics",
  "sql": "…built with $WIN…",
  "actions": [ { "mqtt": { "server": "tcp://mosquitto:1883", "topic": "sensors/events", "sendSingle": true } } ] }
```

### 3.5 `provision.sh`
Wait for REST (`until curl -sf $EKUIPER_URL/ >/dev/null; do sleep 1; done`), create the stream,
then substitute `$WIN` / `$CO_HIGH` into the rule bodies and `POST` each. Idempotent: `DELETE`
the rule id first (ignore 404) so re-runs don't 409. Create **stream before rules**.

## 4. Files created / modified
- `docker/docker-compose.yml` (+ `ekuiper`, `ekuiper-provision`)
- `ekuiper/streams/sensor_stream.json`, `ekuiper/rules/window_metrics.json`,
  `ekuiper/rules/high_co.json`, `ekuiper/provision.sh`
- `docker/.env.example` already has `WINDOW_*`, `CO_HIGH` (Phase 0)

## 5. Acceptance criteria (exit gate)
- [ ] `docker compose up` provisions stream + 2 rules automatically (no manual UI clicks).
- [ ] `mosquitto_sub -t 'sensors/events' -v` shows `WINDOW_METRICS` objects at ~window cadence
      and `HIGH_CO` objects when co crosses the threshold.
- [ ] Changing `WINDOW_TYPE` in `.env` and re-provisioning changes the emission behavior
      (e.g. tumbling→sliding) with no SQL edits.
- [ ] `curl :9081/rules/window_metrics/status` counters climb.

## 6. How to verify
```bash
docker compose --profile mqtt --profile app up -d && \
  docker compose up ekuiper ekuiper-provision -d
mosquitto_sub -h localhost -t 'sensors/events' -v
curl -s http://localhost:9081/rules | jq
```
If nothing fires, temporarily lower `CO_HIGH` to confirm wiring, then restore.

## 7. Write back to SESSION_STATE.md
- Phase 1 → ✅ DONE; record the pinned eKuiper tag and the default window in effect; Next → Phase 2.

## 8. Notes / gotchas
- Container-to-container: broker is `tcp://mosquitto:1883`, never `localhost`.
- Field names/types must match the payload exactly or you get silent NULLs.
- `sendSingle: true` keeps one JSON object per row (trivial for Analytics to parse).
- Keep REST-provisioned rules the single source of truth; treat the manager UI as inspect-only.
