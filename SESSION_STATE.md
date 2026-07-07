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

- **Iteration:** Phase 1 complete → ready for Phase 2.
- **Next action:** **Start Phase 2** (`docs/phases/PHASE-2-analytics-events.md`) — rewire Analytics
  to consume `sensors/events`. Phase 3 (MaaS training) is independent and may run in parallel.
- **Last action:** Phase 1 — stood up eKuiper (`lfedge/ekuiper:2.2.1-slim`, `cep` profile) with a
  typed `sensor_stream` + env-templated **rollup** (`WINDOW_METRICS`) and **threshold** (`HIGH_CO`)
  rules, provisioned reproducibly via REST (`ekuiper/provision.sh`). Verified both event types on
  `sensors/events`; confirmed the WINDOW_TYPE switch works with no SQL edits.
- **Branch:** `main` (Phase-0 committed by user; Phase-1 changes uncommitted).

---

## Phase status

| Phase | Name | Status | Notes |
|-------|------|--------|-------|
| 0 | Foundation & shared contracts | ✅ DONE | P2 base E2E verified (57.8k rows, 100 devices); wire=°C; contracts+thresholds+env keys frozen |
| 1 | eKuiper CEP (stream + rollup + threshold rule) | ✅ DONE | `2.2.1-slim`; tumbling/ss/10; WINDOW_METRICS+HIGH_CO via REST; window switch verified |
| 2 | Analytics consumes events | ⬜ NOT STARTED | drop P2 window; route by event_type; buffer rollups |
| 3 | MaaS offline training | ⬜ NOT STARTED | shared features.py; chrono split; RF; metrics; artifact |
| 4 | MaaS service | ⬜ NOT STARTED | FastAPI /predict /health /model/info; Dockerize |
| 5 | Analytics ↔ MaaS integration | ⬜ NOT STARTED | REST + timeout/fallback; [PREDICTIVE ALERT]; Socket.IO event/alert + REST snapshots |
| 6 | eKuiper advanced rules | ⬜ NOT STARTED | sustained-high + heat/dry correlation |
| 7 | Web app (React+Vite) | ⬜ NOT STARTED | MQTT-WS; feeds + predicted-vs-actual chart |
| 8 | Delivery | ⬜ NOT STARTED | E2E gate; README; GitHub |

Legend: ⬜ NOT STARTED · 🟨 IN PROGRESS · ✅ DONE · ⛔ BLOCKED

---

## Locked decisions (mirror of IMPLEMENTATION_PLAN §0 — quick reference)

- **D1 ML task:** temperature forecasting (regression), target = next-window `avg_temp`.
- **D2 Model:** RandomForestRegressor, global + device one-hot.
- **D3/D4 Features:** lag over last `LAG_WINDOWS=4` window aggregates; shared `maas/features.py`.
- **D5 Unit:** Celsius (verify wire in Phase 1).
- **D6 Window:** env-templated at provision (`WINDOW_TYPE/UNIT/SIZE/STEP`, default `tumbling/ss/10/—`).
- **D7 Rules:** rollup (`WINDOW_METRICS`) + event rules (threshold now; sustained + heat/dry later).
- **D8 Thresholds:** env-driven, °C-calibrated (`TEMP_HIGH=28`, `CO_HIGH=0.010`, `HUMIDITY_LOW=40`, `SMOKE_HIGH=0.030`, `SUSTAINED_TEMP=25`).
- **D9 Analytics:** thin orchestrator, no self-windowing.
- **D10 Web app:** React+Vite+shadcn/ui(base-ui)+Tailwind; live via Socket.IO to Analytics; REST snapshots via axios+TanStack Query; non-blocking.
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
- **Carry to Phase 2:** `window_start`/`window_end` are emitted as **epoch-ms integers** (eKuiper
  native), not the fractional-seconds shown in the contract example — Analytics/chart must treat
  them as ms. `HIGH_CO` (per-message co>threshold) does **not** fire on the current replay sample
  (raw co ~0.003–0.005 < 0.010); wiring proven by temporarily lowering the threshold. Consider
  re-tuning `CO_HIGH` or relying on the Phase-6 windowed rules for demoable events.

---

## Change log (newest first)

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
