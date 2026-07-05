# IMPLEMENTATION_PLAN.md
## IoTS Project 3 — Phased Implementation Plan (high-level index)

> **What this file is.** The single high-level roadmap for building Project 3 on top of the
> clean MQTT-only base described in `docs/REPO-STATE-2026-07-05_1522.md`. It defines the
> **locked decisions**, the **target architecture**, and a **numbered sequence of phases**.
> Each phase has its own self-contained doc under `docs/phases/` that a developer (or an
> agent) can open to *start* or *continue* that phase without re-reading everything.
>
> **How to use it.** Live status lives in `SESSION_STATE.md` (the resume file). To pick up
> work say: *"continue Phase N"* → read `SESSION_STATE.md` then `docs/phases/PHASE-N-*.md`;
> or *"start Phase N"* → read that phase doc's *Entry criteria* and *Context to load first*.
>
> **Sources of truth.** What to build: `docs/REQUIREMENTS-IoTS-3.md`. Why/how deep-dive:
> `docs/IoTS-3-EXPLAINED.md`. Frozen repo snapshot: `docs/REPO-STATE-2026-07-05_1522.md`.
> This plan *operationalizes* those into ordered, gated work.

---

## 0. Locked decisions (do not silently drift)

These were confirmed in the planning iteration and close the open questions from
REPO-STATE §6. Treat them as fixed unless explicitly revisited in `SESSION_STATE.md`.

| # | Decision | Value |
|---|----------|-------|
| D1 | **ML task** | **Temperature forecasting — regression.** Predict next window's `avg_temp` per device. |
| D2 | **Model** | `RandomForestRegressor` (scikit-learn), **global** model with `device` one-hot. Baseline; upgradeable to GBRT/LSTM only if time allows. |
| D3 | **Feature input** | **Lag over the last N window-aggregate vectors** (N = `LAG_WINDOWS`, default 4), not raw readings. eKuiper emits the aggregates; Analytics buffers N and forwards them. |
| D4 | **Feature parity** | One shared transform `maas/features.py`, imported by **both** `train.py` and the service. Analytics carries **no** feature logic — it only forwards the raw N-aggregate history. |
| D5 | **Temperature unit** | **Celsius (native to the dataset).** The "°F" label in earlier docs is a **mislabel** — verified data range is `0–30.6`. All thresholds and the model live in °C. *Verify the wire unit in Phase 1; if Ingestion actually converts, add the same conversion in `train.py`.* |
| D6 | **eKuiper window** | **Configurable via env, applied at provision time** (`provision.sh` templates the `GROUP BY` window clause). Env keys: `WINDOW_TYPE`, `WINDOW_UNIT`, `WINDOW_SIZE`, `WINDOW_STEP`. Default `tumbling / ss / 10 / —`. Change → re-provision (no live UI switch). |
| D7 | **eKuiper rules** | A continuous **rollup** rule (per-window aggregates, feeds forecasting + chart) **plus** CEP **event** rules (threshold in Phase 1; sustained-high + heat/dry correlation in Phase 6). |
| D8 | **Thresholds** | Env-driven and **recalibrated to real °C ranges** (see §3). Not hard-coded `>50`. |
| D9 | **Analytics** | Drops the Project 2 hand-rolled tumbling window (eKuiper owns windowing). Becomes: subscribe → route by `event_type` → buffer rollups → call MaaS → emit enriched alert. |
| D10 | **Web app** | **React + Vite + shadcn/ui (base-ui) + Tailwind CSS**; live data over **Socket.IO** to the Analytics backend; REST snapshots via **axios + TanStack Query**. Read-only, **non-blocking** (pipeline runs with or without it). |
| D11 | **UI transport** | Analytics hosts a **Socket.IO server** (ASGI, mounted alongside FastAPI) and pushes two channels to browsers — `event` (all CEP events incl. `WINDOW_METRICS`) and `alert` (enriched predictive alerts) — plus optional REST snapshot routes. **The browser does not speak MQTT; there is no `ui/alerts` MQTT topic.** Raw event topic stays `sensors/events`. |

**Invariants inherited from REPO-STATE §8 (still binding):** `RAW_TOPIC = sensors/telemetry`
(never rename); eKuiper output `sensors/events`; payload schema fixed; `BROKER_TYPE=mqtt`
everywhere; Storage + TimescaleDB reused unchanged; eKuiper provisioned reproducibly via REST;
image tags pinned; MaaS trains offline only and ships the artifact in the image.

---

## 1. Target architecture (recap)

```
Ingestion ──PUB sensors/telemetry──► Mosquitto ──┬─► Storage ─► TimescaleDB
                                                 │
                                                 └─► eKuiper (CEP)
                                                       • stream over sensors/telemetry
                                                       • ROLLUP rule  (per-window aggregates, every window)
                                                       • EVENT rules  (threshold / sustained / heat-dry)
                                                       └─PUB sensors/events─► Mosquitto
                                                                                  │
                                                                                  ▼
                                          Analytics (FastAPI, thin orchestrator)
                                            • route by event_type
                                            • buffer last N ROLLUPs per device
                                            • POST /predict ──REST──► MaaS (RF regressor)
                                            • emit [PREDICTIVE ALERT]
                                            • hosts Socket.IO server (ASGI)
                                            └─Socket.IO: event + alert channels──► Web app (React+Vite)
                                              REST snapshots (axios / TanStack Query) ┘
```

> There is a **single** Mosquitto broker; it is drawn twice above only to show flow direction.
> The web app connects to **Analytics** (Socket.IO + REST), not to the broker.

**Data-flow contract in one line:** eKuiper turns the raw stream into *tagged window events*;
Analytics enriches *event-of-interest* rows with a *next-window temp forecast* from MaaS and
publishes human-readable predictive alerts; the web app visualizes events, alerts, and
predicted-vs-actual temperature.

---

## 2. Shared contracts (defined here, consumed by every phase)

### 2.1 Topics & transports

| Channel | Kind | Producer | Consumer(s) | Payload |
|---------|------|----------|-------------|---------|
| `sensors/telemetry` (`RAW_TOPIC`) | MQTT | Ingestion | Storage, eKuiper | Raw sensor JSON (REPO-STATE §4) |
| `sensors/events` | MQTT | eKuiper sink | Analytics | Tagged event JSON (§2.2) |
| `POST /predict` | REST | Analytics | MaaS | History → forecast (§2.4) |
| Socket.IO `event` | WS | Analytics | Web app | each `sensors/events` message, relayed (§2.2) |
| Socket.IO `alert` | WS | Analytics | Web app | Enriched predictive-alert JSON (§2.3) |
| `GET /api/*` (snapshots) | REST | Analytics | Web app | recent events/alerts + per-device forecast history |

### 2.2 `sensors/events` payload (eKuiper → Analytics)

Every message is a single JSON object tagged by `event_type`. `sendSingle: true` on the sink.

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

- **`WINDOW_METRICS`** = the rollup rule; emitted **every window** (no `HAVING`). Feeds the
  forecast history buffer **and** the predicted-vs-actual chart.
- **`HIGH_CO` / `SUSTAINED_HIGH_TEMP` / `HEAT_DRYING`** = event-of-interest rules; carry the
  same aggregate fields so Analytics can act without re-buffering.

### 2.3 Enriched alert payload (Analytics → web app, Socket.IO `alert`)

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

### 2.4 MaaS REST contract

`POST /predict` request — the last N window aggregates, oldest→newest:

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

### 2.5 Cross-component numeric invariants (parity — the thing that silently breaks)

| Constant | Meaning | Must match across |
|----------|---------|-------------------|
| `WINDOW_SIZE` (default 10, unit `ss`) | eKuiper window size | eKuiper provision **and** `train.py` CSV windowing |
| `LAG_WINDOWS` (default 4) | # of window aggregates in a feature vector | `train.py`, MaaS `features.py`, Analytics buffer depth |
| Temperature unit | °C (see D5) | dataset, wire, thresholds, model |

> Changing window **size** ⇒ retrain (train.py windowing must match). Changing window **type**
> (tumbling↔sliding↔…) is experimental and mainly changes emission cadence/overlap; the model
> still consumes "avg over ~size" aggregates, so it degrades gracefully rather than breaking.

---

## 3. Recalibrated thresholds (from real dataset ranges)

Verified over all 405,184 rows (Celsius). Defaults for the env-driven thresholds:

| Env key | Default | Rationale (min / max / mean) |
|---------|---------|------------------------------|
| `TEMP_HIGH` | `28.0` | temp 0.0 / 30.6 / 22.5 — only `1c:bf` reaches this ⇒ meaningful, not constant |
| `CO_HIGH` | `0.010` | co 0.0012 / 0.0144 / 0.0046 — top few % |
| `HUMIDITY_LOW` | `40.0` | humidity 1.1 / 99.9 / 60.5 — "dry" side, used in HEAT_DRYING correlation |
| `SMOKE_HIGH` | `0.030` | smoke 0.0067 / 0.0466 / 0.0193 |
| `SUSTAINED_TEMP` | `25.0` | avg over a window; catches sustained warmth without being constant |

> **Data-cleaning note:** `temp == 0.0` appears as a dropout on two devices; drop or interpolate
> those rows in `train.py` (Phase 3). Do **not** feed 0.0 into the forecast target.

---

## 4. Phase map

Graded core is **Phases 1–5**; do those solid first. Phases 6–8 add depth and the deliverable
polish. Each phase doc follows the same template (Context → Goal → Entry → Steps → Files →
Acceptance → Verify → Write-back).

| Phase | Doc | Goal (one line) | Depends on |
|-------|-----|-----------------|-----------|
| **0** | `docs/phases/PHASE-0-foundation-contracts.md` | Verify the reused P2 base runs; commit shared contracts (§2) + env keys. | — |
| **1** | `docs/phases/PHASE-1-ekuiper-cep.md` | eKuiper up, stream + env-templated **rollup** rule + one **threshold** rule → `sensors/events`, provisioned via REST. | 0 |
| **2** | `docs/phases/PHASE-2-analytics-events.md` | Rewire Analytics to consume `sensors/events`, route by `event_type`, buffer rollups, log events (no ML yet). | 1 |
| **3** | `docs/phases/PHASE-3-maas-training.md` | Offline `train.py`: window CSV, lag features (shared transform), chrono split, RF regressor, metrics, dump artifact. | 0 (parallel to 1–2) |
| **4** | `docs/phases/PHASE-4-maas-service.md` | Wrap model in FastAPI (`/predict` `/health` `/model/info`) with shared `features.py`; Dockerize; add to compose. | 3 |
| **5** | `docs/phases/PHASE-5-analytics-maas-integration.md` | Analytics → MaaS REST (timeout + CEP-only fallback); emit `[PREDICTIVE ALERT]`; push to web app over Socket.IO + REST snapshots. **Core done end-to-end.** | 2, 4 |
| **6** | `docs/phases/PHASE-6-ekuiper-advanced-rules.md` | Add sustained-high (`HAVING`) + heat/dry correlation rules; tune thresholds. | 1 |
| **7** | `docs/phases/PHASE-7-webapp.md` | React+Vite app over MQTT-WS: event feed, predictive-alert feed, predicted-vs-actual chart. Non-blocking. | 5 (6 optional) |
| **8** | `docs/phases/PHASE-8-delivery.md` | Full `docker compose up` E2E gate; README + per-microservice descriptions; GitHub. | 5, 7 |

**Suggested execution order:** 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.
Phase 3 (MaaS training) is independent and can be done in parallel with 1–2 if two people work.

---

## 5. Definition of done (project-level exit gate)

- `docker compose --profile mqtt --profile app --profile ml --profile web up` brings up the full
  pipeline; a fresh clone needs **zero manual eKuiper clicks** (REST-provisioned).
- `mosquitto_sub -t 'sensors/events'` shows tagged events; Analytics logs `[PREDICTIVE ALERT]`
  lines with a MaaS forecast; Analytics emits `event`/`alert` over Socket.IO to connected browsers.
- `curl :maas/model/info` reports the task, algorithm, and train/val/test metrics.
- Web app renders the event feed, alerts, and a predicted-vs-actual temp chart while the
  pipeline runs — and the pipeline still runs if the web app is down.
- GitHub repo published with a short paragraph per microservice and a run guide.

---

## 6. Conventions for phase docs & resume

- **Status of record** for every phase is the table in `SESSION_STATE.md`, not the phase doc.
- A phase is **DONE** only when **all** its *Acceptance criteria* pass and its *Write-back*
  step has updated `SESSION_STATE.md`.
- Keep image tags pinned; keep new config in `docker/.env.example` (copied to `docker/.env`).
- Do not break the §2.5 parity invariants; if you must, update **all** listed consumers in the
  same commit and note it in `SESSION_STATE.md`.

> Note: the repo currently also has a hyphenated `SESSION-STATE.md` (P2-era cold-resume). This
> plan standardizes on **`SESSION_STATE.md`** (underscore) as the living tracker; fold the old
> file's still-relevant notes in and treat the underscore file as its successor.
