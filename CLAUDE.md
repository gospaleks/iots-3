# CLAUDE.md

Project reference for code agents + running change log. Keep this current — every iteration
appends a dated entry so the docs stay cross-referenceable. This file starts lean (right after
the P2→P3 cleanup) and is filled in as Project 3 components land.

## What this project is

Event-driven IoT microservices for **IoTS Project 3**: enhance the reused Project 2 pipeline so
analysis is delegated to two specialists instead of hand-coded in Analytics —
**(a) eKuiper** (streaming / CEP engine) detects events of interest from the raw sensor stream
via declarative SQL rules and republishes them; **(b) MaaS** (Model-as-a-Service) serves a
trained ML model over REST. **Analytics orchestrates**: consumes eKuiper events + calls MaaS →
enriched/predictive alerts. **MQTT-only.**

- **What** to build → [docs/REQUIREMENTS-IoTS-3.md](docs/REQUIREMENTS-IoTS-3.md) (source of truth)
- **How / why** → [docs/IoTS-3-EXPLAINED.md](docs/IoTS-3-EXPLAINED.md)
- **Cleanup contract** (this iteration) → [docs/HANDOFF-repo-init-cleanup.md](docs/HANDOFF-repo-init-cleanup.md)
- **Where we left off** → [SESSION-STATE.md](SESSION-STATE.md)

## Architecture in one paragraph

**ingestion** (NestJS, publisher + device simulator) publishes raw telemetry to MQTT topic
`sensors/telemetry`. **storage** (NestJS, subscriber → TimescaleDB writer) and **eKuiper**
(CEP) both subscribe to it. eKuiper's SQL rules emit detected events to `sensors/events`;
**analytics** (FastAPI) subscribes to that, calls the **MaaS** REST service (`POST /predict`)
for an ML prediction, and emits enriched alerts. A **web app** visualizes events, predictions,
and alerts. Reused services communicate **only** through the broker via a `BrokerAdapter`
interface (`BROKER_TYPE=mqtt`); eKuiper↔Analytics is MQTT, Analytics↔MaaS is REST, MaaS never
touches the broker. Docker Compose runs everything (MQTT profile).

## Repo layout (post-cleanup)

```
docs/            REQUIREMENTS-IoTS-3.md (source of truth), IoTS-3-EXPLAINED.md, HANDOFF-repo-init-cleanup.md
data/            dataset CSV (GITIGNORED) — MaaS training data
shared/          dataset_info.md, message-contract.md (canonical payload + topic names)
services/        npm workspaces: libs/{broker,contracts}, ingestion-service, storage-service, analytics-service (FastAPI)
docker/          docker-compose.yml (mqtt/app profiles), mosquitto/, db/init.sql, .env.example
maas/            NEW — features.py (shared transform), train.py, app.py (FastAPI /predict), Dockerfile, models/
ekuiper/         NEW — streams/, rules/, provision.sh (REST-provisioned CEP layer)
webapp/          NEW — web app (placeholder; Phase 7)
```

## Conventions

- **Broker:** MQTT-only. Reused services select the adapter via `BROKER_TYPE=mqtt`; the broker
  abstraction (`BrokerAdapter`/`Publisher`/`Subscriber` + Nest DI, Python mirror) is kept so a
  second broker could slot back in without touching business code.
- **Topics:** raw telemetry `sensors/telemetry` (**`RAW_TOPIC`** — do not rename); eKuiper
  events `sensors/events`. See [shared/message-contract.md](shared/message-contract.md).
- **Payload:** dataset fields + `seq` (per-device counter) + `sent_at_ms` (send time). The
  eKuiper stream schema and MaaS feature set derive from these fields exactly.
- **DB:** TimescaleDB hypertable on `ts`, PK `(ts, device)`. Schema from `docker/db/init.sql`;
  TypeORM `synchronize: false`.
- **eKuiper:** provision streams + rules **reproducibly via the REST API** (init script), not
  by hand in the UI — a fresh `docker compose up` must yield a working CEP layer. Pin the
  image tag (no `latest`).
- **MaaS:** train offline via a committed `train.py` (train/validation/test split + reported
  metrics); ship the serialized artifact in the image; load once at startup, never train at
  boot. **Feature-transform parity:** `train.py` and `/predict` must build features via one
  shared function (the #1 MaaS bug).
- **Dev env:** WSL2 + Docker Desktop (Linux).

## Tech stack

NestJS (mqtt.js, TypeORM) · FastAPI (aiomqtt) · TimescaleDB · Eclipse Mosquitto · LF Edge
eKuiper *(coming)* · scikit-learn / FastAPI MaaS *(coming)* · Docker Compose.

## Per-iteration workflow

Each feature/iteration: (1) summarize deliverables, (2) **propose a commit message following
Conventional Commits** (`type(scope): summary`, e.g. `feat(ekuiper): …`, with the
`Co-Authored-By: Claude Opus 4.8` trailer), (3) append a dated entry to the change log below,
(4) state verification, (5) keep [SESSION-STATE.md](SESSION-STATE.md) up to date so the other
developer can resume with zero context. **Commit only when the user asks.**

---

## Change log

### Webapp rewrite on shadcn/ui + demo-calibrated env + window switchability — 2026-07-14
- **Why:** the Phase-7 webapp was plain React+Tailwind with hardcoded hex, unclear information
  design; `.env` was tuned so every rule fired constantly (spam); and switching to a sliding
  window "showed nothing" on the frontend.
- **webapp/ rewritten from scratch** — scaffolded with
  `npx shadcn@latest init --preset b51GFh7y6 --template vite --pointer` (inner `.git` deleted;
  root repo owns it). Preset resolves to **style `luma`, base `base` (Base UI, *not* Radix —
  `render` not `asChild`), Tailwind **v4** (tokens in `src/index.css`, no `tailwind.config.js`),
  Phosphor icons, Public Sans, React 19 + Recharts 3. Components added via CLI (card, badge,
  table, select, separator, skeleton, scroll-area, tooltip, chart, empty, toggle-group, alert).
  Semantic tokens only — no raw colors (shadcn skill). **`package-lock.json` committed +
  Dockerfile uses `npm ci`** (fixes the reproducibility nit from the 2026-07-13 review).
- **Information design (the actual complaint):** signature **pipeline rail** (Ingestion →
  eKuiper → MaaS → Alerts with live counters) makes the flow the hero; **always-visible legend**
  giving each event type a plain-English meaning (projector-friendly — no hover); devices labeled
  by **profile** ("Cool & humid") not bare MAC; alert cards lead with **now → next + delta badge**
  (the MaaS value-add); "Events only" toggle hides WINDOW_METRICS noise.
- **Burst + window resilience (root-caused the "sliding shows nothing"):** socket messages land
  in a ref and flush on a 400 ms interval ⇒ **one render per flush** regardless of arrival rate.
  Chart no longer merges the two series on an **exact `window_end` key** (only ever lined up for
  contiguous tumbling windows — that was the bug): both series now sit on one **numeric time
  axis**, bucketed to the second, bounded by a **time range** (8 min) not a point count. Works
  under tumbling *and* hopping; survives a sliding flood.
- **Window mode is inferred from the data** (`src/lib/window.ts`: width = `window_end−window_start`,
  step = gap between `window_start`s) and shown in the header — Analytics doesn't know eKuiper's
  config, so this is derived, and it makes a live window switch visible with zero backend wiring.
- **⚠️ Found (pre-existing, not introduced here): eKuiper 2.2.1 emits merged windows.** A plain
  `TUMBLINGWINDOW(ss, 10)` periodically misses a processing-time trigger and emits one 20s window
  (n≈198) instead of two 10s ones (n≈100) — a steady 10/20 alternation on a 30s cycle. Ruled out
  load (~1% CPU), inter-rule interference (reproduces with the other windowed rules stopped), and
  our SQL/env (registered SQL is clean; stream is processing-time). **No data is lost** (100+198 ≈
  300 msg per 30s; windows stay contiguous). Two consequences: (1) a median of observed widths
  would make the header badge read `15–20s`, so `deriveWindowInfo` uses the **25th percentile** —
  merging only ever makes windows *longer*, so the low end is the true config (also ignores the
  partial window at rule start); verified badge reads `tumbling · 10s`. (2) MaaS gets ~half its
  rollups over 20s though trained on 10s → mild train/serve skew, accepted (avg over 20s ≈ avg
  over 10s for this slow signal). Documented in `shared/thresholds.md`.
- **`provision.sh` fail-fast:** `hopping`/`session` with empty `WINDOW_STEP` used to emit
  malformed SQL (`HOPPINGWINDOW(ss, 10, )`) ⇒ rule POST failed ⇒ silently broken CEP layer.
  Now exits 1 with `WINDOW_TYPE=hopping requires WINDOW_STEP (e.g. WINDOW_STEP=5)`; `sliding`
  prints a warning that per-message emission is by design.
- **Env recalibrated to 3 devices** (bare MACs 1:1 with dataset profiles; `device.ts` only
  suffixes when `NUM_DEVICES > 3`), 10 msg/s/device = 30 msg/s (~100 samples/window). Thresholds
  measured live from TimescaleDB so **each rule lights up a different device**:
  `SUSTAINED_TEMP=25` → `1c:bf` (26.9 °C); `TEMP_HIGH=22` + `HUMIDITY_LOW=55` → `b8:27`
  (22.5 °C **and** 50.6 % rh — `1c:bf` is hotter but humid, which is the point of a correlation
  rule); `00:0f` stays quiet as the baseline. Measured steady-state mix: **WINDOW_METRICS ~60 %,
  SUSTAINED ~20 %, HEAT_DRYING ~20 %** + episodic HIGH_CO.
- **`CO_HIGH` gotcha (documented in `shared/thresholds.md`):** `HIGH_CO` is *per-message*, so its
  rate is `msg/s × P(co > thr)`, and this dataset's CO is a **slow-varying signal** ⇒ a percentile
  threshold maps to *time episodes*, not random samples. There is no "occasional" value inside
  `b8:27`'s narrow band (0.0047–0.0051): `0.00502` (p95) ⇒ 17 % of *all* messages ⇒ 95 % of the
  feed; `0.00508` ⇒ ~1 per 10 s at replay start, quiet later. Settled on **`0.00508`** (spikes
  should be rare); note the **replay starts in a high-CO episode**, so it shows on a fresh `up`.
- **Verify (full stack, all 5 profiles, from `--build`):** 9 containers up; eKuiper 4/4 rules
  `running`; `/api/devices` = exactly the 3 bare MACs; all four event types observed with
  forecasts landing (`forecast_available` on the alerts); webapp `:8080` HTTP 200 serving the new
  title + baked `VITE_API_URL`, CORS 200 from the webapp origin; `npm run build` (tsc -b + vite)
  green. **Window switch tested live:** `hopping`/`WINDOW_STEP=5` → `HOPPINGWINDOW(ss, 10, 5)`,
  4/4 rules running, measured width 10 s / step 5 s ⇒ frontend label `hopping · 10s / 5s`;
  empty-step fail-fast returns exit 1. `.env` restored to `tumbling`.
- **Gotcha for next session:** running `docker compose` with a *subset* of profiles treats the
  other profiles' containers as orphans and removes them — always pass all five profile flags.
- **Docs:** `shared/thresholds.md` (per-device calibration table + CO rationale + window-switch
  section), root `README.md` (new stack, per-device story, window switching), `objasnjenje.md`
  (new **§5c "Kako se čita dashboard"** — badges, chart, why the forecast line is dashed *and
  leads*, delta badge, CEP-only fallback, live window-switch demo; §5c/§5d renumbered).
- **Commit (proposed):** split in two —
  1. `fix(cep): fail fast on missing WINDOW_STEP + demo-calibrate env for a 3-device pipeline`
  2. `feat(webapp): rewrite dashboard on shadcn/ui — window-agnostic chart, buffered live streams`

### Post-delivery cross-review of Phases 5–8 — 2026-07-13
- **Reviewed** the colleague-authored commits (`e6231e8`, `5429648`): Analytics orchestration
  (events/maas_client/socketio_server/main), eKuiper Phase-6 rules + provision.sh, compose,
  MaaS app, and the whole webapp.
- **Suspicion "Analytics only consumes HIGH_CO" — false alarm.** Routing in `events.py` is
  generic: everything that is not `WINDOW_METRICS` goes through `_enrich_and_emit()`; the
  `HIGH_CO` branch only selects the log-line format. `SUSTAINED_HIGH_TEMP`/`HEAT_DRYING`
  are consumed and enriched.
- **Fixed — ForecastChart off-by-one-window:** the next-window forecast was plotted at the
  triggering window's `window_end`, so predicted-vs-actual compared forecast(t+1) with
  actual(t). Now shifted forward by `window_end - window_start` (alerts without window info,
  e.g. per-message HIGH_CO, keep the `ts` fallback) — the forecast dot also now correctly
  leads the actual line ("pre-emptive" reads visually).
- **Fixed — contracts doc parity:** added `SUSTAINED_HIGH_TEMP`/`HEAT_DRYING` constants to
  `contracts.py` (the missing constants were what made the diff *look* HIGH_CO-only) and
  switched `events.py` to the `HIGH_CO` constant.
- **Noted, not changed:** (1) MaaS calls are awaited serially in the consume loop — a slow
  (not down) MaaS at ~1s/call could back up under the ~33 SUSTAINED_HIGH_TEMP events per 10s
  window; down-MaaS is instant-fail and verified fine. (2) If an interest event beats its
  window's `WINDOW_METRICS` over MQTT, the forecast is based on a buffer ending one window
  earlier — inherent ordering, harmless. (3) `webapp` has no committed `package-lock.json`
  and the Dockerfile uses `npm install` (caret ranges) — builds aren't fully reproducible;
  consider committing a lockfile + `npm ci`.
- **Verify:** `python3 -m py_compile` on touched modules green; `npm run build`
  (tsc -b + vite) green.
- **Commit (proposed):** `fix(review): align forecast chart to predicted window + contracts parity for Phase-6 event types`

### Phase 8 — Delivery: E2E gate + README + objasnjenje.md — 2026-07-12
- **Full pipeline on one command:** `docker compose -f docker/docker-compose.yml --profile mqtt
  --profile app --profile cep --profile ml --profile web up -d` → 9 containers healthy
  (timescaledb, mosquitto, ingestion, storage, analytics, ekuiper, ekuiper-provision, maas,
  webapp), all provisioning REST-driven (zero eKuiper UI clicks on a fresh clone).
- **E2E verified from a clean `down` → `up` cycle:** eKuiper 4/4 rules `running` (window_metrics
  + high_co + sustained_high_temp + heat_drying); Analytics buffers reach 4/4 across all 100
  simulated devices in ~30s; `[PREDICTIVE ALERT] device=1c:bf:ce:15:ec:4d-82 eKuiper=
  SUSTAINED_HIGH_TEMP (avg 25.6°C) | MaaS=next 27.6°C | pre-emptive` streaming in Analytics logs;
  ring buffer of 200 SUSTAINED_HIGH_TEMP alerts populated; webapp HTTP 200 with live event
  feed / alert cards / predicted-vs-actual chart rendering.
- **`objasnjenje.md`** authored at repo root — Serbian, mapped point-by-point to the
  professor's project task (1a eKuiper CEP, 1b MaaS REST, 2 CEP subscription+republish,
  3 Python+FastAPI+scikit-learn, 4 Docker+web app, 5 GitHub+per-service description). Includes
  architecture diagram, per-microservice paragraphs, parity invariants, an elevator-pitch
  ("šta reći na odbrani"), and a documentation-trace table for follow-up questions.
- **README (root)** updated with the full 5-profile compose command, `webapp` (port 8080)
  and `maas` (port 8000 + Swagger `/docs`) in the Service control surface table, and the
  MaaS model card summary.
- **Commit (proposed):** `feat(iots3): complete Phases 5–8 — MaaS integration, advanced CEP, web app, delivery`

### Phase 7 — Web app (React + Vite + Tailwind + Socket.IO + Recharts) — 2026-07-12
- **Stack (locked in the phase doc, delivered):** React 18 + Vite 6 + TypeScript + Tailwind
  CSS 3 + TanStack Query 5 + axios + socket.io-client 4 + Recharts 2. Scaffolded by hand
  (no `create-vite` in a container, cleaner for reproducibility). All configs pinned.
- **Data layer:** `api.ts` (axios client + `connectSocket()` helper + typed `CepEvent` /
  `EnrichedAlert` / `ForecastPoint`). **`useLiveStreams` hook** seeds `events` + `alerts`
  React state from TanStack Query snapshots (`/api/events`, `/api/alerts`) then subscribes
  the `socket.io-client` to `event` + `alert` channels and appends into rolling caps
  (200 events / 100 alerts) so unbounded growth isn't a demo footgun.
- **Views (Tailwind, no shadcn/ui shortcut):** `StatusBar` (Socket.IO connected pill +
  device count), `DeviceSelector`, **`EventFeed`** (rolling table color-coded by
  event_type — WINDOW_METRICS muted, HIGH_CO amber, SUSTAINED_HIGH_TEMP/HEAT_DRYING red),
  **`AlertFeed`** (cards showing actual/forecast temps + `[PREDICTIVE ALERT]` line +
  "forecast vX.Y" badge or "CEP-only" fallback), **`ForecastChart`** (Recharts LineChart:
  white solid `actual_avg_temp` from WINDOW_METRICS + blue-dashed `forecast_next_avg_temp`
  from alerts, merged by ts).
- **Dockerized:** multi-stage build — `node:22-alpine` builder → `nginx:1.27-alpine`
  runtime with `nginx.conf` (SPA fallback, gzip). `VITE_API_URL` baked at build time via
  compose `args:` (default `http://localhost:3003`, overridable with `WEBAPP_API_URL`).
  New **`web` profile** — port 8080 → nginx :80. **Non-blocking (D10)**: nothing
  `depends_on` webapp; pipeline runs fine when it's stopped.
- **Verified in the Browser pane:** `Socket.IO connected` pill green; devices dropdown
  lists all 100 simulated device ids; event feed streaming HIGH_CO rows; predictive alert
  cards showing `actual = 25.6°C · forecast = 25.5°C` with `forecast v1.0` badge; chart
  renders forecast dot for the selected device.
- **Commit (proposed part of):** `feat(iots3): complete Phases 5–8 — MaaS integration, advanced CEP, web app, delivery`

### Phase 6 — eKuiper advanced rules (SUSTAINED_HIGH_TEMP + HEAT_DRYING) — 2026-07-12
- **Two new rules** wired the same reproducible way as Phase 1 (JSON template →
  `provision.sh` sed-substitutes env values → DELETE-then-POST via REST):
  - **`ekuiper/rules/sustained_high_temp.json`** — windowed aggregation with `HAVING`:
    `GROUP BY device, __WIN__ HAVING AVG(temp) > __SUSTAINED_TEMP__`. Emits the full
    rollup shape (avg_temp/max/min/humidity/co/lpg/smoke + sample_count + window_start/end)
    so Analytics can enrich without re-buffering. Default `SUSTAINED_TEMP=25.0` catches
    `1c:bf:ce:15:ec:4d` (avg ~26.5°C) but leaves the other two devices below.
  - **`ekuiper/rules/heat_drying.json`** — multi-condition correlation:
    `HAVING AVG(temp) > __TEMP_HIGH__ AND AVG(humidity) < __HUMIDITY_LOW__` — the classic
    "genuine CEP" example beyond a single filter (default TEMP_HIGH=28, HUMIDITY_LOW=40).
    On this dataset it stays quiet at defaults (humidity stays ~60 avg) — wiring proven
    by temporarily loosening thresholds via REST during test.
- **`provision.sh`:** added `SUSTAINED_TEMP`, `TEMP_HIGH`, `HUMIDITY_LOW` env reads and
  matching `sed -e` substitutions inside `provision_rule()`; added two more
  `provision_rule` calls at the end. Idempotent — re-runs the same way as before.
- **`docker-compose.yml`:** `ekuiper-provision` now passes those three env vars from `.env`.
- **Verified on fresh boot:** `GET /rules` shows all four with `status: "running"`;
  `mosquitto_sub -t sensors/events` shows `SUSTAINED_HIGH_TEMP` events flowing at
  window cadence for `1c:bf:ce:15:ec:4d-*` devices; Analytics feeds them through the
  Phase-5 enrichment path (`[PREDICTIVE ALERT] ... SUSTAINED_HIGH_TEMP (avg 25.6°C) |
  MaaS=next 27.6°C | pre-emptive`).
- **Commit (proposed part of):** `feat(iots3): complete Phases 5–8 — MaaS integration, advanced CEP, web app, delivery`

### Phase 5 — Analytics ↔ MaaS integration + Socket.IO + REST snapshots — 2026-07-12
- **Analytics is now the orchestrator (D9).** Full rewrite of `events.py` to be async and
  route non-`WINDOW_METRICS` events through `_enrich_and_emit()`; new `maas_client.py` and
  `socketio_server.py` modules; new REST snapshot routes; ASGI wraps FastAPI with Socket.IO
  so `/socket.io`, `/api/*`, `/health`, `/stats` all share port 3003.
- **`maas_client.py`:** async `httpx.AsyncClient(base_url=MAAS_URL, timeout=MAAS_TIMEOUT_MS/1000)`.
  `predict(device, history)` builds the exact §MaaS-REST payload (device + list of the 4
  `_PREDICT_FIELDS` per window) and POSTs `/predict`. **Any failure returns `None`** — the
  three narrow branches (timeout, HTTPStatusError, HTTPError) log a `WARNING`; a defensive
  catch-all logs and still returns None. **The subscribe loop must never stall** — this is
  the entire point of the Phase-5 resilience acceptance.
- **`socketio_server.py`:** `SioBus` wraps `socketio.AsyncServer(async_mode="asgi",
  cors_allowed_origins=…)`. Three in-memory ring buffers (all `deque(maxlen=RING_BUFFER_SIZE=200)`):
  `_events`, `_alerts`, and per-device `_forecast`. Emit paths append then `await sio.emit(...)`.
  Snapshot getters slice the last `limit` entries for the REST routes.
- **`events.py` — the routing/enrichment core:** `EventProcessor.handle()` (now `async`)
  emits every incoming event to `sio.event` first (so the chart's actual-line updates for
  every 10s window); if `event_type == WINDOW_METRICS`, appends to the device buffer and
  returns; otherwise logs `[EVENT] <type>` and calls `_enrich_and_emit()`. That method
  reads the device buffer, if it has exactly `LAG_WINDOWS` entries and `MaasClient` is set
  awaits `predict()`, then builds the enriched-alert dict per §message-contract Enriched
  alert (ts / device / event_type / actual_avg_temp / forecast_next_avg_temp /
  forecast_available / model_version / message / window_start / window_end /
  decision_time_ms). The `message` is human-readable:
  `[PREDICTIVE ALERT] device=<d> eKuiper=<type> (avg <t>°C) | MaaS=next <f>°C | pre-emptive`
  when the forecast lands, or `| MaaS=unavailable (buffer not full yet)` or
  `| MaaS=unavailable (prediction unavailable)` on the two fallback paths. Emits `sio.alert`
  and logs the message line.
- **`main.py` (rewrite):** load config eagerly so `SioBus(cors, ring_size)` can be
  constructed at module scope (`socketio.ASGIApp` needs a live server before uvicorn starts;
  keeps the same instance the lifespan wires into the `EventProcessor`). Lifespan builds
  `Metrics` + `MaasClient` + `EventProcessor(cfg, metrics, maas=maas, sio=sio_bus)`, kicks off
  `consume_loop(adapter, processor)` in an `asyncio.Task` (wrapping `processor.handle()` in a
  try/except so one bad event never kills the loop), and on shutdown `await maas.close()`.
  Uvicorn serves `asgi_app = socketio.ASGIApp(sio_bus.sio, other_asgi_app=fastapi_app)`.
- **REST snapshots (§message-contract Snapshots + §D11):**
  - `GET /api/events?limit=` — last N raw `sensors/events` (used for chart's actual line + feed seed).
  - `GET /api/alerts?limit=` — last N enriched alerts (feed seed).
  - `GET /api/forecast/{device}?limit=` — per-device history of `(ts, actual, forecast, available)`.
  - `GET /api/devices` — devices seen so far (drives the selector).
- **Compose:** `analytics` service now passes `MAAS_URL`, `MAAS_TIMEOUT_MS`, `LAG_WINDOWS`,
  `SOCKETIO_CORS_ORIGINS` via env; `.env.example` already carried the keys (Phase 0).
- **Verified live** (fresh full-stack boot):
  - `[PREDICTIVE ALERT] device=… eKuiper=HIGH_CO | MaaS=next 22.3°C | pre-emptive` streaming
    on `docker logs iots-analytics`.
  - `curl :3003/api/alerts?limit=5` returns the exact enriched-alert JSON shape.
  - `docker stop iots-maas` → alerts keep flowing but with
    `MaaS=unavailable (prediction unavailable)` and `forecast_available:false`; no hang;
    `docker start iots-maas` → forecasts resume.
- **Commit (proposed part of):** `feat(iots3): complete Phases 5–8 — MaaS integration, advanced CEP, web app, delivery`

### Phase 4 — MaaS FastAPI service — 2026-07-09
- **`maas/app.py` — FastAPI wrapper.** `lifespan` handler loads `MODEL_PATH` + `model_meta.json`
  **once** at startup and stores them on `app.state`; **no training at boot** (Phase 4 acceptance).
  Pydantic models (`HistoryWindow`, `PredictRequest`, `PredictResponse`) give a free Swagger UI at
  `/docs` for the demo. Endpoints match `shared/message-contract.md`: `GET /health` →
  `{"status":"ok"}`, `GET /model/info` → task/algorithm/features/lag_windows/window_size_sec/metrics/
  trained_at/version (from `model_meta.json`), `POST /predict` → `{prediction,target,unit,device,model_version}`.
- **`feature_vector` imported verbatim from `features.py`** — the single shared transform (D4). No
  parallel feature code in the service; the #1 MaaS bug (train/serve skew) can't happen.
- **Fail-fast parity guard at startup:** raises if `model.n_features_in_ != len(FEATURE_NAMES)` or
  `model_meta.lag_windows != LAG_WINDOWS`. A silent drift breaks the demo, not startup.
- **Validation → 400, never 500** (Phase 4 §3.2): wrong `history` length or unknown `device`
  (base MAC not in `DEVICES` after stripping ingestion `-N`) return `HTTPException(400)` with a
  clear detail. Verified: valid → 26.70 °C; `history` length 3 → 400; unknown MAC → 400;
  suffixed device `1c:bf:ce:15:ec:4d-27` → same 26.70 °C as bare (proves `base_device()`).
- **`maas/Dockerfile`** — `python:3.12-slim`, requirements pinned (`fastapi==0.115.6`,
  `uvicorn[standard]==0.34.0` added). **Artifact ships in the image**: `COPY models/model.joblib
  model_meta.json metrics.json /models/` matches the `.env` default `MODEL_PATH=/models/model.joblib`
  so no env override is needed. Shell-form `CMD uvicorn app:app --host 0.0.0.0 --port ${MAAS_PORT}`
  so the env var expands. `.dockerignore` keeps `train.py` + `__pycache__` out of the image.
- **Compose:** new **`ml` profile** with the `maas` service (`iots-maas:latest`, port 8000; env:
  `MODEL_PATH`/`MODEL_META_PATH`/`MAAS_PORT`/`LAG_WINDOWS`/`WINDOW_SIZE`/`CORS_ORIGINS`).
  Full pipeline is now `--profile mqtt --profile app --profile cep --profile ml up -d`.
- **Verify:** `docker compose --profile ml build maas` clean; startup log
  `model ready | version=1.0 features=19 lag_windows=4 window_size_sec=10`; all three endpoints
  respond as expected; container torn down between steps.
- **Commit (proposed):** `feat(maas): FastAPI /predict /health /model/info + Dockerfile (ml profile)`

### Phase 3 — MaaS offline training — 2026-07-08
- **`maas/features.py` — the single shared transform** (imported verbatim by `train.py` now and the
  service in Phase 4; train/serve skew is the #1 MaaS bug). `windows_from_readings` buckets raw
  readings into `WINDOW_SIZE`-second aggregates (same schema as the eKuiper rollup);
  `feature_vector` builds the **19-feature** input (4-lag `avg_temp`/`avg_humidity`/`avg_co`, latest
  `max_temp`, rolling mean/std of `avg_temp`, trend, 3-device one-hot). `base_device()` strips the
  ingestion `-N` suffix so training (bare MACs) and serving (`MAC-N`) share one one-hot.
- **`maas/train.py`:** loads the CSV with the stdlib `csv` module (no pandas), drops `temp==0`
  dropout rows (7), builds per-device aggregate series, slides `LAG_WINDOWS` to form
  (X, y=next-window `avg_temp`), does a **per-device chronological 70/15/15 split** (no shuffle)
  then concatenates, fits `RandomForestRegressor`, reports **MAE/RMSE/R² on val+test**, and dumps
  `model.joblib` + `metrics.json` + `model_meta.json`.
- **Artifact size gotcha:** unbounded RF trees memorized every sample → a **737 MB** artifact that
  also overfit. Bounding (`max_depth=16, min_samples_leaf=25, n_estimators=150`) + `compress=3`
  gives a **14 MB** artifact that generalizes better: **test** MAE 0.073 / RMSE 0.420 / **R² 0.988**
  (val R² 0.985). Celsius; `WINDOW_SIZE=10s`, `LAG_WINDOWS=4`, version 1.0.
- **Verify:** trained in a container off the local `iots-analytics` image (host has no sklearn;
  Docker Hub pulls hit a WSL2 credential-helper glitch); model loads with `n_features_in_=19`
  matching `FEATURE_NAMES`, and a `feature_vector`→`predict` smoke test returns a sensible 25.56 °C.
- **Repo policy:** `model.joblib` is gitignored (build output, ships in the image — Phase 4); the
  small `metrics.json`/`model_meta.json` are kept for review. Also corrected the stale "Fahrenheit"
  label in `shared/dataset_info.md` (Celsius, per Phase 0).
- **Commit (proposed):** `feat(maas): offline train.py + shared features.py (RF, chrono split, metrics)`

### Phase 2 — Analytics consumes eKuiper events — 2026-07-07
- **Repointed Analytics** (`services/analytics-service`) from the raw telemetry topic to
  `sensors/events`, and **retired the Project 2 tumbling window** (eKuiper owns windowing, D9):
  deleted `app/window.py`, dropped the window task from `main.py`, and removed the window/threshold
  metrics from `metrics.py` (now event counters keyed by `event_type`).
- **Thin orchestrator, no feature logic (D4):** `app/events.py` `EventProcessor` routes each event
  by `event_type` and keeps a per-device `deque(maxlen=LAG_WINDOWS)` of the **raw** `WINDOW_METRICS`
  aggregate dicts (forwarded verbatim to MaaS in Phase 5). Event-of-interest types (`HIGH_CO`, and
  the Phase-6 additions) are logged distinctly.
- **Contracts/config:** `contracts.py` now mirrors the `sensors/events` payload (retired
  `SensorMessage`; events are plain dicts since the field set differs per type); the broker adapter
  yields `(Event, ReceivedMeta)`; `config.py` reads `EVENTS_TOPIC`/`LAG_WINDOWS` (dropped
  `WINDOW_SIZE_SEC`/`ALERT_THRESHOLD`). `/stats` exposes `bufferDepthByDevice` + `eventsByType`.
- **Gotcha carried forward:** `sensors/events` has **no `sent_at_ms`**; `ReceivedMeta.received_at_ms`
  is Analytics' own decision-time stamp (basis for a Phase-5 event-to-alert latency).
- **Verify:** rebuilt image, ran the full `mqtt+app+cep` stack — Analytics subscribes to
  `sensors/events`, per-device buffers fill to 4/4 across 100 devices (`/stats` confirms), and
  `[EVENT] HIGH_CO` lines appear when `CO_HIGH` is temporarily lowered. No P2 window code in the
  active path. Stack torn down.
- **Commit (proposed):** `feat(analytics): consume sensors/events, route by type, buffer rollups`

### Phase 1 — eKuiper CEP (stream + rollup + threshold rule) — 2026-07-07
- **Added eKuiper to compose** under a new `cep` profile: `ekuiper` (pinned
  `lfedge/ekuiper:2.2.1-slim`, REST on 9081, MQTT source → `tcp://mosquitto:1883`) + a one-shot
  `ekuiper-provision` (`curlimages/curl`) that provisions everything via REST and exits. Bring the
  full stack up with `docker compose --profile mqtt --profile app --profile cep up -d` (note: every
  compose command now needs the profile flags, since `ekuiper` `depends_on: mosquitto`).
- **Stream + rules** (`ekuiper/`): typed `sensor_stream` over `sensors/telemetry` (`ts` as **FLOAT**
  — fractional epoch seconds would silently NULL under BIGINT); a continuous **rollup**
  `window_metrics` (`WINDOW_METRICS`, no HAVING, emits every window) and a per-message **threshold**
  `high_co` (`HIGH_CO`, `co > CO_HIGH`). Both sink to `sensors/events` with `sendSingle: true`.
- **`provision.sh`** waits for the REST API, builds the `GROUP BY` window clause from env (D6:
  `WINDOW_TYPE/UNIT/SIZE/STEP`), creates the stream **if missing** (a running rule pins the stream,
  so drop-and-recreate fails), and DELETE-then-POSTs each rule — fully idempotent/re-runnable.
- **Verify:** fresh `up` auto-provisions stream + 2 rules (no UI clicks); `WINDOW_METRICS` flows at
  ~10s cadence with the full aggregate schema and `HIGH_CO` fires when co crosses threshold (proven
  by temporarily lowering `CO_HIGH` to 0.004 — the default 0.010 isn't crossed by the current replay
  sample); rule counters climb with 0 exceptions; switching `WINDOW_TYPE` (tumbling→sliding) changes
  emission with no SQL edits. `window_start/end` are epoch-**ms** integers (eKuiper native).
- **Commit (proposed):** `feat(ekuiper): add CEP stream + rollup/threshold rules provisioned via REST`

### Phase 0 — Foundation & shared contracts — 2026-07-07
- **Verified the reused P2 base runs end-to-end on Docker** (the pending item after Kafka
  removal): `docker compose --profile mqtt --profile app up -d` → Ingestion publishing 1000 msg/s
  to `sensors/telemetry`, Storage subscribed and writing to TimescaleDB (57.8k rows, 100 devices,
  BATCH mode), Analytics emitting P2 window `[INFO]`/`[LATENCY]` lines. **No Kafka errors.**
- **Confirmed the wire unit is Celsius** (D5): raw `temp` 19.7/24.4/22.1, DB `temp` min 0.1 /
  max 28.3 / avg 22.35. Ingestion does no conversion ⇒ `train.py` needs none. The Analytics
  `°F` log suffix is a cosmetic P2 mislabel (removed when Analytics is rewired in Phase 2).
- **Froze shared contracts:** extended `shared/message-contract.md` with the `sensors/events`
  payload, the Socket.IO enriched-alert payload, and the MaaS `POST /predict` REST contract +
  parity notes; added `shared/thresholds.md` (°C-calibrated thresholds + window/feature constants).
- **Added P3 env keys** to `docker/.env.example` (window, thresholds, `EVENTS_TOPIC`, MaaS URL/
  timeout, `LAG_WINDOWS`, Socket.IO CORS, `MODEL_PATH`/`MAAS_PORT`) — declared, not yet wired.
- **Verify:** `docker compose --profile mqtt --profile app config` parses with the new keys; stack
  torn down cleanly. `SESSION_STATE.md` written back (Phase 0 → ✅, E2E + wire-unit items ticked).
- **Commit (proposed):** `docs(phase-0): freeze shared contracts + P3 env keys; verify P2 base E2E`

### Iteration 0 — Repo init: prune Project 2 → clean MQTT-only Project 3 base — 2026-07-03
- **Deleted all standalone Project-2-only artifacts:** `benchmarks/`, `results/`, `dashboard/`,
  `docker/kafka/`, and all P2 docs (`docs/REQUIREMENTS.md`, `docs/DECISIONS.md`, `docs/report.md`,
  `docs/PLAN.md`, `docs/plan/`, `docs/notes/`, `docs/sr/`) + a stray `docker/package-lock.json`.
- **Removed Kafka entirely** (opted into HANDOFF §6): deleted `kafka.adapter.ts` +
  `kafka_adapter.py`, stripped the broker-type switch/branches, `KAFKA_TOPIC`, `KAFKA_ACKS`/
  `KAFKA_GROUP_ID`, `acks`/`groupId`/`ANALYTICS_GROUP_ID`, and the `kafkajs`/`aiokafka` deps.
  The **thin broker adapter is kept** (interfaces + Nest DI + factory), now MQTT-only.
- **Trimmed Docker to the MQTT pipeline:** removed the `kafka`/`kafka-ui` services + `kafka-data`
  volume, renamed the compose project `iots2` → `iots3`, stripped Kafka vars from `.env.example`.
  Kept Storage + TimescaleDB (reused, per REQUIREMENTS §2). `docker compose config` parses; all
  5 services (timescaledb, mosquitto, ingestion, storage, analytics) resolve.
- **Docs:** added the three P3 docs to `docs/`; rewrote `README.md`, this `CLAUDE.md`, and
  `SESSION-STATE.md` for Project 3.
- **Scaffolded** empty `maas/`, `ekuiper/`, `webapp/` placeholders (stub READMEs).
- **Verify:** `services` build clean (4 workspaces); broker unit tests green (4/4); no `kafka`/
  `kafkajs` references remain in `services/`+`docker/` (bar an intentional "reject non-mqtt" test);
  end-to-end MQTT pipeline run left as the Docker verification step.
- **Commit (proposed):** `chore: prune Project 2 apparatus → clean MQTT-only Project 3 base`
  (or the per-part sequence in the plan / HANDOFF §10).
