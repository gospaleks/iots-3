# ekuiper/ — Streaming / CEP layer

LF Edge **eKuiper** turns the raw telemetry stream into *tagged window events*. It subscribes to
`sensors/telemetry`, applies declarative SQL rules, and sinks detected events to `sensors/events`
(consumed by Analytics). Everything here is **provisioned reproducibly via the REST API** by a
one-shot init container — never hand-created in the manager UI, so a fresh `docker compose up`
yields a working CEP layer with zero manual clicks.

Background: [docs/REQUIREMENTS-IoTS-3.md §6.1](../docs/REQUIREMENTS-IoTS-3.md),
[docs/IoTS-3-EXPLAINED.md §4](../docs/IoTS-3-EXPLAINED.md). Payloads: [shared/message-contract.md](../shared/message-contract.md).

## Layout

```
streams/sensor_stream.json    typed stream over sensors/telemetry
rules/window_metrics.json     ROLLUP rule  → WINDOW_METRICS  (emitted every window)
rules/high_co.json            THRESHOLD rule → HIGH_CO       (per-message, co > CO_HIGH)
provision.sh                  waits for REST, creates stream + POSTs rules (idempotent)
```

Rule/stream files are **templates** with `__TOKEN__` placeholders (`__WIN__`, `__CO_HIGH__`,
`__EVENTS_TOPIC__`, `__BROKER_URL__`, `__RAW_TOPIC__`) that `provision.sh` substitutes at run time.

## The stream & rules

- **`sensor_stream`** — typed schema over `sensors/telemetry`. `ts` is **FLOAT** (fractional epoch
  seconds would silently NULL under BIGINT).
- **`window_metrics` → `WINDOW_METRICS`** — a continuous rollup (`AVG/MAX/MIN` of the sensor fields
  + `sample_count`, `window_start`, `window_end`), **no `HAVING`** so it emits every window. Feeds
  the Analytics forecast buffer and the predicted-vs-actual chart.
- **`high_co` → `HIGH_CO`** — a per-message threshold filter (`co > CO_HIGH`).

Both sink to `sensors/events` with `sendSingle: true` (one JSON object per row).

## Env-templated window (D6)

`provision.sh` builds the `GROUP BY` window clause from env, so the window type/size is switchable
**without editing any SQL** — just change `.env` and re-provision:

| Env | Default | Meaning |
|-----|---------|---------|
| `WINDOW_TYPE` | `tumbling` | `tumbling\|hopping\|sliding\|session\|count` |
| `WINDOW_UNIT` | `ss` | `ms\|ss\|mi\|hh\|dd` |
| `WINDOW_SIZE` | `10` | window length |
| `WINDOW_STEP` | *(empty)* | hop/delay/maxDuration/interval for non-tumbling windows |
| `CO_HIGH` | `0.010` | `HIGH_CO` threshold (see [shared/thresholds.md](../shared/thresholds.md)) |

> `WINDOW_SIZE` must match `maas/train.py` (parity invariant — changing it means retraining).

## Run

The `ekuiper` service `depends_on: mosquitto`, so **every compose command needs the profile flags**:

```bash
cd docker
docker compose --profile mqtt --profile app --profile cep up -d
```

`ekuiper` (pinned `lfedge/ekuiper:2.2.1-slim`) exposes the REST API on **:9081**; the one-shot
`ekuiper-provision` waits for it, provisions, and exits 0. It is idempotent — re-running (e.g.
after editing a rule or `.env`) DELETE-then-POSTs each rule and skips the already-existing stream.

Re-provision after an `.env` change without a full restart:

```bash
docker compose --profile mqtt --profile app --profile cep run --rm ekuiper-provision
```

## Verify / inspect

```bash
curl -s http://localhost:9081/rules | jq                       # both rules "running"
curl -s http://localhost:9081/rules/window_metrics/status | jq # counters climb, 0 exceptions
docker compose --profile mqtt --profile app --profile cep \
  exec mosquitto mosquitto_sub -t 'sensors/events' -v          # WINDOW_METRICS + HIGH_CO
```

## Notes / gotchas

- Container-to-container the broker is `tcp://mosquitto:1883`, never `localhost`.
- `window_start` / `window_end` are emitted as **epoch-ms integers** (eKuiper native), not the
  fractional seconds shown in the contract example — treat them as ms downstream.
- `HIGH_CO` does **not** fire on the current replay sample (raw `co` ~0.003–0.005 < the 0.010
  default); the wiring is correct — temporarily lower `CO_HIGH` and re-provision to see it fire.
- Keep REST-provisioned rules the single source of truth; treat any manager UI as inspect-only.
