# SESSION_STATE.md
## IoTS Project 3 — living state / cold-resume tracker

> **Read this first when resuming.** It is the source of truth for *where we are*. Then open
> `IMPLEMENTATION_PLAN.md` (roadmap) and the specific `docs/phases/PHASE-N-*.md` for the phase
> you're starting/continuing.
>
> **Update discipline:** each phase's *Write-back* step edits the status table below and the
> "Last action / Next action" block. Keep it short and truthful — no aspirational entries.

---

## Current position

- **Iteration:** 🎉 **ALL PHASES (0–8) COMPLETE — project delivered.** Post-delivery: code
  review (2026-07-13) + **webapp rewritten on shadcn/ui with demo-calibrated env (2026-07-14)**.
  All uncommitted.
- **Next action:** commit (2 proposed commits — see change log below). If a future iteration is
  scoped: extend the eKuiper rule set (rate-of-change / spike rule), add rolling MAE to the
  chart, or a Grafana dashboard fed by TimescaleDB.
- **Last action (2026-07-14):** **webapp rewrite + demo tuning.** `webapp/` regenerated with
  `npx shadcn@latest init --preset b51GFh7y6 --template vite --pointer` (inner `.git` removed) →
  React 19 + shadcn/ui (Base UI, Tailwind v4, Phosphor, `luma`), lockfile committed + `npm ci`.
  New information design (pipeline rail, always-visible event legend, profile-labeled devices,
  now→next delta alert cards). Chart rewritten to a **numeric time axis** (no exact-key merge) so
  it works under tumbling *and* hopping and survives a sliding flood; socket messages buffered and
  flushed on an interval (one render per flush). `provision.sh` **fails fast** when
  `hopping`/`session` lack `WINDOW_STEP`. Env recalibrated to **3 bare-MAC devices**, thresholds
  measured from TimescaleDB so each rule fires on a *different* device. Full-stack E2E verified
  (4/4 rules, all event types, forecasts, webapp 200); hopping switch verified live.
- **Previous action (2026-07-13):** cross-review of colleague's Phases 5–8. Confirmed the
  suspected "Analytics only handles HIGH_CO" is a false alarm (routing is generic: every
  non-WINDOW_METRICS event is enriched; the HIGH_CO `if` only picks the log format). Fixed:
  (a) `ForecastChart.tsx` plotted the next-window forecast at the *triggering* window's
  `window_end` — now shifted one window forward so predicted-vs-actual align; (b) added
  `SUSTAINED_HIGH_TEMP`/`HEAT_DRYING` constants to `contracts.py` + use `HIGH_CO` constant
  in `events.py`. Verified: `py_compile` green, `npm run build` (tsc + vite) green.
- **Previous action:** Phase 8 delivery — full E2E gate green on fresh clean-boot with a single
  `docker compose --profile mqtt --profile app --profile cep --profile ml --profile web up -d`:
  Ingestion publishing 1000 msg/s, Storage writing to Timescale, eKuiper all 4 rules `running`
  (window_metrics + high_co + sustained_high_temp + heat_drying), Analytics buffer 4/4 across
  100 devices, `[PREDICTIVE ALERT] device=1c:bf:ce:15:ec:4d-82 eKuiper=SUSTAINED_HIGH_TEMP
  (avg 25.6°C) | MaaS=next 27.6°C | pre-emptive`, ring buffer 200 SUSTAINED_HIGH_TEMP alerts,
  webapp HTTP 200 with live event feed / alert cards / predicted-vs-actual chart. Authored
  root **objasnjenje.md** (Serbian, mapped point-by-point to the professor's task).
- **Branch:** `main` (Phases 0–2 committed/pushed by user; Phase-3..8 changes uncommitted → will
  be delivered as a single feat/deliver commit + push at the end of this session).

---

## Phase status

| Phase | Name | Status | Notes |
|-------|------|--------|-------|
| 0 | Foundation & shared contracts | ✅ DONE | P2 base E2E verified (57.8k rows, 100 devices); wire=°C; contracts+thresholds+env keys frozen |
| 1 | eKuiper CEP (stream + rollup + threshold rule) | ✅ DONE | `2.2.1-slim`; tumbling/ss/10; WINDOW_METRICS+HIGH_CO via REST; window switch verified |
| 2 | Analytics consumes events | ✅ DONE | subscribes `sensors/events`; per-device buffer 4/4; `/stats` depths; HIGH_CO logged; no ML yet |
| 3 | MaaS offline training | ✅ DONE | shared `features.py`; chrono split; RF (test R²=0.988, MAE=0.073°C); 14 MB artifact + meta |
| 4 | MaaS service | ✅ DONE | FastAPI (lifespan load-once); /health /model/info /predict; 400 handling; Dockerized under `ml` profile |
| 5 | Analytics ↔ MaaS integration | ✅ DONE | httpx client (1s timeout, CEP-only fallback); [PREDICTIVE ALERT]; Socket.IO event/alert; REST snapshots /api/{events,alerts,forecast/{device},devices} |
| 6 | eKuiper advanced rules | ✅ DONE | +sustained_high_temp (HAVING) + heat_drying (multi-cond correlation), env-templated thresholds, provisioned via REST alongside existing 2 rules |
| 7 | Web app (React+Vite) | ✅ DONE (**rewritten 2026-07-14**) | React 19 + **shadcn/ui** (Base UI, Tailwind v4, Phosphor) + socket.io-client + Recharts 3; pipeline rail + event stream w/ legend + alert cards + actual-vs-forecast chart; window-agnostic + burst-buffered; multi-stage Docker (`npm ci`) + nginx; `web` profile |
| 8 | Delivery | ✅ DONE | Fresh-clean-boot E2E green on `--profile mqtt --profile app --profile cep --profile ml --profile web`; root `objasnjenje.md` for the professor's presentation; README rewrite; commit+push |

Legend: ⬜ NOT STARTED · 🟨 IN PROGRESS · ✅ DONE · ⛔ BLOCKED

---

## Locked decisions (mirror of IMPLEMENTATION_PLAN §0 — quick reference)

- **D1 ML task:** temperature forecasting (regression), target = next-window `avg_temp`.
- **D2 Model:** RandomForestRegressor, global + device one-hot.
- **D3/D4 Features:** lag over last `LAG_WINDOWS=4` window aggregates; shared `maas/features.py`.
- **D5 Unit:** Celsius (verify wire in Phase 1).
- **D6 Window:** env-templated at provision (`WINDOW_TYPE/UNIT/SIZE/STEP`, default `tumbling/ss/10/—`).
- **D7 Rules:** rollup (`WINDOW_METRICS`) + event rules (threshold now; sustained + heat/dry later).
- **D8 Thresholds:** env-driven, °C-calibrated. **Recalibrated 2026-07-14 for the 3-device demo**
  (`SUSTAINED_TEMP=25` → `1c:bf`; `TEMP_HIGH=22` + `HUMIDITY_LOW=55` → `b8:27`; `CO_HIGH=0.00508`
  → episodic spikes on `b8:27`; `00:0f` = quiet baseline). Each rule fires on a *different* device
  by design — see `shared/thresholds.md` for the measured per-device table and the CO rationale.
- **D9 Analytics:** thin orchestrator, no self-windowing.
- **D10 Web app:** React+Vite+**shadcn/ui (Base UI, Tailwind v4, Phosphor icons)**; live via
  Socket.IO to Analytics; REST snapshots via `fetch` (TanStack Query + axios dropped in the
  2026-07-14 rewrite — one small hook covers seed+live); non-blocking.
- **D11 UI transport:** Analytics hosts a Socket.IO server (`event` + `alert` channels) + REST snapshot routes; the browser does **not** speak MQTT (no `ui/alerts` topic).

## Parity invariants (never break silently)

- `WINDOW_SIZE` matches between eKuiper provision and `train.py`.
- `LAG_WINDOWS` matches across `train.py`, MaaS `features.py`, Analytics buffer.
- Temperature unit consistent (°C) across dataset, wire, thresholds, model.
- `RAW_TOPIC=sensors/telemetry` (never rename); eKuiper out = `sensors/events`; UI via Socket.IO from Analytics (no MQTT in the browser).

---

## Open items / risks carried forward

- [x] **Wire-unit check** (done Phase 0): Ingestion publishes **°C** with no conversion — raw
      wire 19.7/24.4/22.1, DB `temp` min 0.1 / max 28.3 / avg 22.35. No `train.py` conversion
      needed. (Analytics P2 log still prints a cosmetic `°F` suffix — removed in Phase 2.)
- [x] **E2E on a Docker host** (done Phase 0): full `--profile mqtt --profile app` stack came up
      clean — Storage wrote 57.8k rows across 100 devices, Analytics emitted window/[INFO]/[LATENCY]
      lines, **no Kafka errors**.
- [x] eKuiper tag pinned (Phase 1): **`lfedge/ekuiper:2.2.1-slim`** (verified on Docker Hub, pulled).
- **Carry forward:** `window_start`/`window_end` are emitted as **epoch-ms integers** (eKuiper
  native), not the fractional-seconds shown in the contract example — Analytics/chart must treat
  them as ms.
- [x] **`CO_HIGH` re-tuned** (done 2026-07-14): the old default `0.010` never fired (b8:27 tops out
      at 0.00512). Now `0.00508`. **Known limitation, don't "fix" it blindly:** `HIGH_CO` is
      *per-message*, so its rate is `msg/s × P(co > thr)`, and this dataset's CO is a slow-varying
      signal ⇒ a percentile threshold maps to *time episodes*, not random samples. There is no
      value inside b8:27's narrow band giving a steady "occasional" rate — `0.00502` (p95) floods
      (17 % of **all** messages ⇒ 95 % of the feed), `0.00508` is quiet outside the high-CO
      episodes. The replay **starts** in a high-CO episode, so it does show on a fresh `up`.
- [x] **Sliding window "shows nothing"** (root-caused 2026-07-14): two separate causes — (a)
      `hopping`/`session` with empty `WINDOW_STEP` emitted malformed SQL so rules silently failed
      to create (now fail-fast in `provision.sh`); (b) `sliding` emits **one event per message** by
      design, and the old chart merged actual/forecast on an **exact `window_end` key** that only
      lines up for contiguous tumbling windows. Chart now uses a numeric time axis + 1s bucketing.
- **Profile gotcha:** running `docker compose` with a *subset* of profiles treats the other
  profiles' containers as orphans and removes them — always pass all five profile flags.
- ⚠️ **OPEN (pre-existing, found 2026-07-14): eKuiper 2.2.1 emits merged windows.** A plain
  `TUMBLINGWINDOW(ss, 10)` periodically misses a processing-time trigger → steady alternation of
  10s (n≈100) and 20s (n≈198) windows on a 30s cycle. **Ruled out:** load (~1 % CPU), inter-rule
  interference (reproduces with the other windowed rules stopped — single rule alone), our SQL/env
  (registered SQL clean; stream = processing time, no `TIMESTAMP` option). **No data lost**
  (100+198 ≈ 300 msg/30s; windows contiguous). **No longer affects the web app** (2026-07-15): the
  header badge reads the configured window from `GET /api/window` instead of inferring it from
  observed widths, so merged windows can't skew it (the old `deriveWindowInfo` needed a
  25th-percentile hack for exactly this). **Accepted for MaaS:** ~half the rollups span 20s though the model was
  trained on 10s ⇒ mild train/serve skew; predictions stay sensible (slow-moving signal). Revisit
  only if forecast accuracy matters more than the demo — would need an eKuiper-level fix
  (event-time windows via a `TIMESTAMP` stream option, or a newer eKuiper).

---

## Change log (newest first)

- **2026-07-14** — **Webapp rewritten on shadcn/ui + demo-calibrated env + window switchability.**
  - **Why:** the Phase-7 webapp was plain React+Tailwind with hardcoded hex and unclear
    information design; `.env` had every rule firing constantly (event spam); and switching to a
    sliding window "showed nothing" on the frontend.
  - **`webapp/` regenerated from scratch:** `npx shadcn@latest init --preset b51GFh7y6 --template
    vite --pointer`, inner `.git` deleted (root repo owns it), old app removed. Preset →
    style `luma`, **base `base` (Base UI, not Radix — `render`, not `asChild`)**, **Tailwind v4**
    (tokens in `src/index.css`, *no* `tailwind.config.js`), Phosphor icons, Public Sans,
    React 19, Recharts 3. Components via CLI (card, badge, table, select, separator, skeleton,
    scroll-area, tooltip, chart, empty, toggle-group, alert). Semantic tokens only.
    `package-lock.json` committed; Dockerfile now `npm ci` (closes the 2026-07-13 review nit).
    TanStack Query + axios dropped (plain `fetch` + one hook).
  - **Information design:** signature **pipeline rail** (Ingestion → eKuiper → MaaS → Alerts with
    live counters); **always-visible legend** with plain-English meaning per event type
    (projector-friendly, no hover); devices labeled by **profile** ("Cool & humid") not bare MAC;
    alert cards lead with **now → next + delta badge**; "Events only" toggle hides WINDOW_METRICS.
  - **Burst/window resilience:** socket messages buffer in a ref, flush every 400 ms ⇒ **one
    render per flush** at any arrival rate. Chart: both series on **one numeric time axis**,
    bucketed to the second, bounded by an 8-min **time range** (not a point count) — no exact-key
    merge (that was the tumbling-only assumption that broke). Window mode was **inferred from the
    data** (`src/lib/window.ts`) and shown in the header — superseded 2026-07-15 by `/api/window`.
  - **`ekuiper/provision.sh`:** fail-fast (exit 1) when `hopping`/`session` lack `WINDOW_STEP`
    (previously emitted `HOPPINGWINDOW(ss, 10, )` ⇒ rule POST failed ⇒ silently broken CEP);
    `sliding` now warns that per-message emission is by design.
  - **Env recalibrated (`docker/.env` + `.env.example`):** `NUM_DEVICES=3` (bare MACs, 1:1 with
    dataset profiles — `device.ts` only suffixes above 3), 10 msg/s/device = 30 msg/s (~100
    samples/window). Thresholds measured live from TimescaleDB so **each rule lights a different
    device**: `SUSTAINED_TEMP=25` → `1c:bf` (26.9 °C); `TEMP_HIGH=22`+`HUMIDITY_LOW=55` → `b8:27`
    (22.5 °C **and** 50.6 % rh; `1c:bf` is hotter but humid ⇒ excluded, which is the point of a
    correlation rule); `CO_HIGH=0.00508` → episodic spikes on `b8:27`; `00:0f` = quiet baseline.
    Added `RING_BUFFER_SIZE=200` (was undeclared). Measured steady-state mix: WINDOW_METRICS
    ~60 %, SUSTAINED ~20 %, HEAT_DRYING ~20 % + episodic HIGH_CO.
  - **Verified (full stack, all 5 profiles, from `--build`):** 9 containers up; eKuiper 4/4
    `running`; `/api/devices` = the 3 bare MACs; all four event types observed with forecasts
    landing; webapp `:8080` HTTP 200 with new title + baked `VITE_API_URL`; CORS 200 from the
    webapp origin; `npm run build` green. **Window switch live:** `hopping`+`WINDOW_STEP=5` →
    `HOPPINGWINDOW(ss, 10, 5)`, 4/4 running, measured width 10 s / step 5 s ⇒ header reads
    `hopping · 10s / 5s`; empty-step fail-fast → exit 1. `.env` restored to `tumbling`.
  - **Docs:** `shared/thresholds.md` (per-device calibration table, CO rationale, window-switch
    section), root `README.md`, `objasnjenje.md` (new **§5c "Kako se čita dashboard"** — badges,
    chart, why the forecast is dashed *and leads*, delta badge, CEP-only fallback, live
    window-switch demo; old §5c → §5d), `CLAUDE.md`.
  - **Commits (proposed, split in two):**
    1. `fix(cep): fail fast on missing WINDOW_STEP + demo-calibrate env for a 3-device pipeline`
    2. `feat(webapp): rewrite dashboard on shadcn/ui — window-agnostic chart, buffered live streams`

- **2026-07-12** — 🎉 **Project delivered (Phases 5–8 done on one session).**
  - **Phase 5 — Analytics ↔ MaaS + Socket.IO + REST snapshots.** Bumped
    `services/analytics-service/requirements.txt` (+ `httpx==0.27.2`,
    `python-socketio==5.11.4`). New `config.py` fields: `maas_url`, `maas_timeout_ms`,
    `socketio_cors_origins`, `ring_buffer_size`. New modules: **`maas_client.py`**
    (async `httpx.AsyncClient` with base_url + hard timeout; returns `None` on any
    error so subscribe loop never stalls) and **`socketio_server.py`** (SioBus wraps
    `socketio.AsyncServer` + three in-memory ring buffers: events, alerts, per-device
    forecast history — feed both `emit_*` and `snapshot_*` for REST). `events.py`
    turned into an **async orchestrator**: `handle()` emits every event to `sio.event`,
    routes non-`WINDOW_METRICS` types through `_enrich_and_emit()` (posts buffered
    rollup history to MaaS, builds §Enriched-alert payload, emits `sio.alert`, logs
    `[PREDICTIVE ALERT]` line). `main.py` mounts `socketio.ASGIApp(sio, other_asgi_app=fastapi)`
    so REST + `/socket.io` share port 3003; new REST snapshot routes `/api/events`,
    `/api/alerts`, `/api/forecast/{device}`, `/api/devices`. Compose passes MAAS_URL /
    MAAS_TIMEOUT_MS / LAG_WINDOWS / SOCKETIO_CORS_ORIGINS via env. **Verified live**:
    `[PREDICTIVE ALERT] ... MaaS=next 26.7°C | pre-emptive` streaming; snapshots return
    ≤200 entries; fallback proven by stopping MaaS — every alert then reads
    `MaaS=unavailable (prediction unavailable)`, subscribe loop keeps running.
  - **Phase 6 — eKuiper advanced rules.** New `ekuiper/rules/sustained_high_temp.json`
    (windowed `HAVING AVG(temp) > __SUSTAINED_TEMP__`) and `heat_drying.json`
    (multi-condition correlation `HAVING AVG(temp) > __TEMP_HIGH__ AND AVG(humidity) <
    __HUMIDITY_LOW__`), same rollup shape so Analytics buffers them like WINDOW_METRICS.
    `provision.sh` now reads `SUSTAINED_TEMP`, `TEMP_HIGH`, `HUMIDITY_LOW` from env and
    substitutes them into each rule at POST time; compose `ekuiper-provision` env
    passes those from `.env`. **4 rules `running`** on fresh boot (window_metrics,
    high_co, sustained_high_temp, heat_drying); SUSTAINED_HIGH_TEMP fires on
    `1c:bf:ce:15:ec:4d` (avg 25.6°C > 25.0) and Analytics enriches it with MaaS
    forecast (avg=25.6°C → next=27.6°C).
  - **Phase 7 — Web app.** React + Vite + TypeScript + Tailwind + TanStack Query +
    axios + socket.io-client + Recharts scaffolded from scratch in `webapp/` (no
    `create-vite` in a container — hand-written for reproducibility). Components:
    **`StatusBar`** (Socket.IO status pill + device count), **`EventFeed`** (rolling
    table color-coded by event_type), **`AlertFeed`** (predictive alert cards showing
    actual °C vs forecast °C vs model version + full `[PREDICTIVE ALERT]` line),
    **`ForecastChart`** (Recharts LineChart: actual solid line + forecast dashed
    line, merged by ts), **`DeviceSelector`**. `useLiveStreams` hook seeds from
    TanStack Query snapshots then keeps state live via socket.io-client with rolling
    caps. Multi-stage `Dockerfile` (node build → nginx serve), `VITE_API_URL` baked
    at build time via compose `args:`. **Non-blocking** (D10): under `web` profile,
    nothing `depends_on` it; verified pipeline still runs when webapp is stopped.
    Screenshot at `http://localhost:8080` shows live event feed + alert cards with
    "forecast v1.0" badges.
  - **Phase 8 — Delivery.** **Full E2E green on a clean-boot single command**:
    `docker compose --profile mqtt --profile app --profile cep --profile ml --profile web up -d`
    → 9 containers healthy, telemetry flowing, eKuiper all 4 rules `running`,
    Analytics buffers 4/4 across 100 devices, `[PREDICTIVE ALERT]` streaming with
    forecast, ring buffer 200 alerts of SUSTAINED_HIGH_TEMP, webapp HTTP 200 with
    live chart + feeds. Authored root **`objasnjenje.md`** in Serbian, mapped
    point-by-point to the professor's task (1a/1b/2/3/4/5), with elevator pitch
    ("Sta reci na odbrani"). Root `README.md` updated with the full pipeline run
    command + MaaS Swagger and webapp URLs.
  - **Commit (proposed):** `feat(iots3): complete Phases 5–8 — MaaS integration, advanced CEP, web app, delivery`

- **2026-07-09** — Phase 4 done: MaaS FastAPI service. `maas/app.py` uses the FastAPI
  `lifespan` handler to `joblib.load(MODEL_PATH)` and read `model_meta.json` **once** at
  startup (no training at boot); parity guard fails fast if `model.n_features_in_` disagrees
  with `len(FEATURE_NAMES)` or `meta.lag_windows != LAG_WINDOWS`. Pydantic models
  (`HistoryWindow`, `PredictRequest`, `PredictResponse`) power the free `/docs` Swagger UI.
  Validation returns 400 (never 500) for wrong `history` length or an unknown device
  (`base_device()` strips the ingestion `-N` suffix — the suffixed id `1c:bf:ce:15:ec:4d-27`
  produces the same prediction as the bare MAC). `/predict` calls
  `feature_vector(history, device)` from the shared `features.py` verbatim (D4). `maas/Dockerfile`
  (python:3.12-slim, requirements pinned, artifact copied to `/models/` to match the `.env`
  default `MODEL_PATH=/models/model.joblib`) ships the model IN the image; `.dockerignore`
  keeps `train.py` and pycache out. Added `maas` compose service under new **`ml` profile**
  (port 8000, respects `.env` MAAS_PORT/MODEL_PATH/LAG_WINDOWS/CORS_ORIGINS). Live smoke:
  `/health` → ok; `/model/info` returns full meta incl. `metrics.val/test` and `trained_at`;
  `POST /predict` on the message-contract example returns `prediction: 26.70 °C`, `unit:"C"`,
  `model_version:"1.0"`. Compose header + phase table say bring up with
  `--profile mqtt --profile app --profile cep --profile ml up -d`. Next → Phase 5.
- **2026-07-08** — Phase 3 done: offline MaaS training. `maas/features.py` is the **single** feature
  transform (imported by train + service): `windows_from_readings` (bucket raw readings into
  WINDOW_SIZE=10s aggregates) + `feature_vector` (19 features: 4-lag avg_temp/avg_humidity/avg_co,
  latest max_temp, rolling mean/std, trend, 3-device one-hot) with `base_device()` stripping the
  ingestion `-N` suffix so train (bare MACs) and serve (suffixed) share the one-hot. `train.py`:
  drop `temp==0` (7 rows), per-device chronological 70/15/15 split (no shuffle) then concat,
  RandomForest(n_estimators=150, max_depth=16, min_samples_leaf=25) — bounded to keep the artifact
  14 MB (`compress=3`); unbounded trees ballooned to 737 MB **and** overfit. Metrics saved to
  `models/metrics.json` + `models/model_meta.json`: **val** MAE 0.058 / RMSE 0.369 / R² 0.985;
  **test** MAE 0.073 / RMSE 0.420 / R² 0.988. Verified via load + predict smoke test in the
  container (no host sklearn). `model.joblib` gitignored; the JSON meta is kept. Next → Phase 4.
- **2026-07-07** — Phase 2 done: rewired the FastAPI Analytics service to consume `sensors/events`.
  `config.py` now reads `EVENTS_TOPIC`/`LAG_WINDOWS` (dropped `WINDOW_SIZE_SEC`/`ALERT_THRESHOLD`);
  `contracts.py` mirrors the event payload (retired `SensorMessage`); the broker adapter yields raw
  event dicts; new `app/events.py` `EventProcessor` routes by `event_type` and keeps a per-device
  `deque(maxlen=LAG_WINDOWS)` of rollups; `metrics.py` counts events by type; `main.py` dropped the
  window task; deleted `app/window.py`. `/stats` exposes `bufferDepthByDevice` + `eventsByType`.
  Verified live end-to-end (buffers 4/4 × 100 devices, `[EVENT] HIGH_CO` when threshold lowered).
  Next → Phase 3.
- **2026-07-07** — Phase 1 done: added `ekuiper` + one-shot `ekuiper-provision` services to
  compose under a new `cep` profile (pinned `lfedge/ekuiper:2.2.1-slim`). Authored the typed
  `ekuiper/streams/sensor_stream.json` (ts as FLOAT to avoid silent NULLs on fractional epoch
  seconds), rollup rule `window_metrics.json` (`WINDOW_METRICS`, no HAVING) and threshold rule
  `high_co.json` (`HIGH_CO`), plus `ekuiper/provision.sh` — waits for REST, builds the GROUP BY
  window clause from env (D6), create-if-missing stream, DELETE-then-POST rules (idempotent).
  Verified: auto-provision on `up`, both event types on `sensors/events`, counters climbing (0
  exceptions), tumbling→sliding switch with no SQL edits. Next → Phase 2.
- **2026-07-07** — Phase 0 done: verified the reused P2 base runs end-to-end on Docker
  (Storage → TimescaleDB 57.8k rows/100 devices, Analytics window logs, no Kafka errors);
  confirmed the wire unit is **Celsius** (no conversion); extended `shared/message-contract.md`
  with the `sensors/events` / alert / MaaS REST contracts; added `shared/thresholds.md`; added
  the P3 env keys (window/thresholds/MaaS/Socket.IO) to `docker/.env.example`. `docker compose
  config` parses. Next → Phase 1.
- **2026-07-05** — Planning iteration: locked D1–D11; recalibrated thresholds; authored
  `IMPLEMENTATION_PLAN.md`, this tracker, and `docs/phases/PHASE-0..8`.
