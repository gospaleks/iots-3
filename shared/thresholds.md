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

**Recalibrated for the 3-device demo** (`NUM_DEVICES=3` ⇒ bare MACs, one per dataset
profile). The goal is that every rule fires *visibly but without spamming the web app*,
and that each rule lights up a **different** device — so the audience can see which
condition belongs to which sensor. Measured live from TimescaleDB on the replay sample:

| Device (profile) | avg temp | avg humidity | CO (median / p95 / max) | Fires |
|---|---|---|---|---|
| `00:0f:00:70:91:0a` (cool & humid) | 19.6 °C | 75.6 % | 0.0026 / — / 0.0031 | *nothing* — the quiet baseline |
| `1c:bf:ce:15:ec:4d` (highly variable) | 26.9 °C | ~72–78 % | 0.0041 / — / 0.0048 | `SUSTAINED_HIGH_TEMP` |
| `b8:27:eb:bf:9d:51` (warm & dry) | 22.5 °C | 50.6 % | 0.00486 / 0.00502 / 0.00512 | `HEAT_DRYING` + `HIGH_CO` |

| Env key | Default | Rationale | Used by |
|---------|---------|-----------|---------|
| `SUSTAINED_TEMP` | `25.0` | window avg temp; only `1c:bf` (26.9 °C) clears it ⇒ ~1 event / window, never for the other two | `SUSTAINED_HIGH_TEMP` (`HAVING`) |
| `TEMP_HIGH` | `22.0` | paired with `HUMIDITY_LOW`; only `b8:27` (22.5 °C **and** 50.6 % rh) satisfies both. `1c:bf` is hotter but humid ⇒ excluded, which is the point of a *correlation* rule | `HEAT_DRYING` |
| `HUMIDITY_LOW` | `55.0` | the "dry" side of the correlation — above `b8:27` (50.6 %), below `1c:bf` (~72 %) | `HEAT_DRYING` |
| `CO_HIGH` | `0.00508` | top of `b8:27`'s CO band (~p99 of 0.0047–0.0051). CO in this dataset is a **slow-varying signal**, so a percentile threshold maps to *time episodes*, not random samples: `HIGH_CO` fires in occasional bursts (≈1 per 10 s at replay start, quiet later) rather than continuously. Lower values flood — `0.00502` (p95) makes 17 % of *all* messages fire ⇒ 95 % of the event feed | `HIGH_CO` |
| `SMOKE_HIGH` | `0.030` | smoke 0.0067 / 0.0466 / 0.0193 | *(declared, no rule uses it)* |

> **Why `CO_HIGH` is fussy:** `HIGH_CO` is a **per-message** rule, so its event rate is
> `msg/s × P(co > threshold)`. At 10 msg/s per device there is no threshold inside
> `b8:27`'s narrow CO band that yields a *steady* "occasional" rate — it is either a
> flood or silent, depending on where the replay is. `0.00508` picks the top of the band,
> which reads correctly as a spike. If you need `HIGH_CO` guaranteed on-screen for a
> demo, lower it to `0.00502` for a minute and put the event feed on "Events only".

> **Measured mix at these defaults** (steady state, tumbling 10 s, 3 devices × 10 msg/s):
> `WINDOW_METRICS` ~60 %, `SUSTAINED_HIGH_TEMP` ~20 %, `HEAT_DRYING` ~20 %, plus episodic
> `HIGH_CO` — a few events per second total, which is readable in the web app.

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

### Switching the window type

```bash
# overlapping-window demo: 10s windows emitted every 5s
#   docker/.env → WINDOW_TYPE=hopping   WINDOW_STEP=5
docker compose -f docker/docker-compose.yml --profile mqtt --profile app \
  --profile cep --profile ml --profile web up -d --force-recreate ekuiper-provision
```

`provision.sh` builds the `GROUP BY` clause from these vars, so **no SQL is edited**. Notes,
all verified live:

- **`hopping` / `session` require `WINDOW_STEP`.** Left empty they'd emit malformed SQL
  (`HOPPINGWINDOW(ss, 10, )`) and the rule POST would fail, leaving a silently broken CEP
  layer — so `provision.sh` now **fails fast** with
  `WINDOW_TYPE=hopping requires WINDOW_STEP (e.g. WINDOW_STEP=5)` (exit 1).
- **`sliding` emits one event per incoming message**, by design (eKuiper re-evaluates the
  window on every arrival) — that is the burst of Socket.IO traffic you'd see, not a bug.
  `provision.sh` prints a warning. Use `hopping` for a readable overlapping-window demo;
  the web app survives `sliding` (buffered flush + per-second downsampling) but the feed
  is inherently noisy.
- **The web app infers the window mode from the data** (`window_end - window_start` = width,
  gap between consecutive `window_start`s = step) and shows it in the header, e.g.
  `window tumbling · 10s` → `window hopping · 10s / 5s`. Nothing else needs configuring.

### ⚠️ Known eKuiper quirk: merged windows (10s/20s alternation)

Measured on eKuiper **2.2.1-slim** with a plain `TUMBLINGWINDOW(ss, 10)`: it periodically
**misses a processing-time trigger and emits one merged window instead of two**, giving a steady
`10s (n≈100) → 20s (n≈198) → 10s → 20s …` alternation (boundaries land at t≡0 and t≡20 of a 30s
cycle). Verified it is **not** ours to fix:

- **No data is lost** — 100 + 198 ≈ 300 messages per 30 s at 30 msg/s; windows stay contiguous
  (0 non-contiguous transitions) and each aggregate is correct *for the window it reports*.
- **Not load or CPU** — reproduces with the eKuiper container at ~1 % CPU.
- **Not inter-rule interference** — reproduces with `sustained_high_temp`/`heat_drying` stopped,
  i.e. a single windowed rule alone.
- **Not our SQL/env** — the registered SQL is exactly `… GROUP BY device, TUMBLINGWINDOW(ss, 10)`,
  and the stream has no `TIMESTAMP` option (processing time).

Consequences, both accepted:

1. **Web app: not affected** — the header badge reads the *configured* window from Analytics
   (`GET /api/window`), which echoes the same `WINDOW_*` keys compose feeds `ekuiper-provision`.
   It used to infer the window from observed `window_end − window_start`, which this bug made
   awkward (a merged window is twice as wide, so a median landed on 15–20 s and the badge lied;
   it needed a 25th-percentile hack to read `10s`). Reading the config sidesteps the bug entirely
   and is correct on first paint instead of after a few windows. ✅
2. **MaaS:** roughly half the rollups cover 20 s while the model was trained on 10 s aggregates —
   a mild train/serve skew on those samples (an avg over 20 s ≈ an avg over 10 s for a
   slow-moving signal, so predictions stay sensible; `R²=0.988` was measured on clean 10 s
   windows). Worth revisiting if forecast quality ever matters more than the demo.
- **Analytics/MaaS keep working** under `hopping`: the per-device buffer just holds the last
  4 (now overlapping) rollups, so the forecast still returns — "next window" simply means
  "next hop". Only `LAG_WINDOWS` is a hard parity break (MaaS raises at startup).

## Topics / transport

- `RAW_TOPIC` = `sensors/telemetry` (never rename) · `EVENTS_TOPIC` = `sensors/events`.
- Web app transport is Socket.IO + REST from Analytics — **no MQTT in the browser** (D11).

See `shared/message-contract.md` for the full payload shapes.
