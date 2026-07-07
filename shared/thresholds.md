# Thresholds & window/feature constants

> Canonical, env-driven configuration for the eKuiper CEP rules and the MaaS/Analytics feature
> pipeline. Recalibrated to the **real dataset ranges (Celsius)** — not the P2-era hard-coded
> `>50` values. Source: `IMPLEMENTATION_PLAN.md` §2.5 + §3. Defaults live in `docker/.env.example`;
> copy to `docker/.env` to override.

## Temperature unit — Celsius (verified on the wire)

The dataset is native **Celsius**; the "°F" label in earlier P2 docs/logs is a **mislabel**.
Verified in Phase 0 on the live stack:

- Raw `sensors/telemetry` values sit in **0–30 °C** (sampled 19.7 / 24.4 / 22.1).
- TimescaleDB `sensor_data`: `temp` min 0.1 / max 28.3 / avg 22.35 over 100 devices.
- Ingestion performs **no** unit conversion, so `train.py` needs none either.

All thresholds, the model target, and every wire value are °C. (The Analytics P2 window log still
prints a literal `°F` suffix — cosmetic only, removed when Analytics is rewired in Phase 2.)

## Event thresholds (eKuiper — Phase 1/6)

Verified over all 405,184 dataset rows. Env-driven; defaults below.

| Env key | Default | Rationale (min / max / mean) | Used by |
|---------|---------|------------------------------|---------|
| `TEMP_HIGH` | `28.0` | temp 0.0 / 30.6 / 22.5 — only device `1c:bf` reaches this ⇒ meaningful, not constant | threshold rule |
| `CO_HIGH` | `0.010` | co 0.0012 / 0.0144 / 0.0046 — top few % | `HIGH_CO` |
| `HUMIDITY_LOW` | `40.0` | humidity 1.1 / 99.9 / 60.5 — "dry" side | `HEAT_DRYING` correlation |
| `SMOKE_HIGH` | `0.030` | smoke 0.0067 / 0.0466 / 0.0193 | threshold rule |
| `SUSTAINED_TEMP` | `25.0` | avg over a window; catches sustained warmth without being constant | `SUSTAINED_HIGH_TEMP` (`HAVING`) |

> **Data-cleaning note:** `temp == 0.0` is a sensor dropout on two devices. Drop or interpolate
> those rows in `train.py` (Phase 3); never feed 0.0 into the forecast target.

## Window & feature constants (parity invariants)

| Env key | Default | Meaning | Must match across |
|---------|---------|---------|-------------------|
| `WINDOW_TYPE` | `tumbling` | eKuiper window type (`tumbling\|hopping\|sliding\|session\|count`) | eKuiper provision |
| `WINDOW_UNIT` | `ss` | window time unit (`ms\|ss\|mi\|hh\|dd`) | eKuiper provision + `train.py` |
| `WINDOW_SIZE` | `10` | window length (in `WINDOW_UNIT`) | eKuiper provision **and** `train.py` CSV windowing |
| `WINDOW_STEP` | *(empty)* | hop/delay/maxDuration/interval for non-tumbling windows | eKuiper provision |
| `LAG_WINDOWS` | `4` | # of window aggregates in one feature vector | `train.py`, MaaS `features.py`, Analytics buffer depth |

> Changing window **size** ⇒ retrain (`train.py` windowing must match). Changing window **type**
> mainly changes emission cadence/overlap; the model still consumes "avg over ~size" aggregates,
> so it degrades gracefully rather than breaking.

## Topics / transport

- `RAW_TOPIC` = `sensors/telemetry` (never rename) · `EVENTS_TOPIC` = `sensors/events`.
- Web app transport is Socket.IO + REST from Analytics — **no MQTT in the browser** (D11).

See `shared/message-contract.md` for the full payload shapes.
