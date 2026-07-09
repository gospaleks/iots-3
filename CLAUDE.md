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
