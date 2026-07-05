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

- **Iteration:** planning complete → implementation not started.
- **Next action:** **Start Phase 0** (`docs/phases/PHASE-0-foundation-contracts.md`).
- **Last action:** Locked D1–D11, recalibrated thresholds to real °C ranges, wrote the phased plan.
- **Branch:** `main` @ `6a4448d` (clean MQTT-only base; see `docs/REPO-STATE-2026-07-05_1522.md`).

---

## Phase status

| Phase | Name | Status | Notes |
|-------|------|--------|-------|
| 0 | Foundation & shared contracts | ⬜ NOT STARTED | verify P2 base runs; commit topics/env/contracts |
| 1 | eKuiper CEP (stream + rollup + threshold rule) | ⬜ NOT STARTED | env-templated window; provision via REST |
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

- [ ] **Wire-unit check (Phase 1):** confirm Ingestion publishes °C. If it converts to °F,
      add the identical conversion in `train.py` and re-baseline thresholds.
- [ ] **E2E on a Docker host still pending** (P2 base was not re-run after Kafka removal — see
      REPO-STATE §9). Fold this verification into Phase 0.
- [ ] Decide final `lfedge/ekuiper` pinned tag in Phase 1 (verify current 2.x-slim at build time).

---

## Change log (newest first)

- **2026-07-05** — Planning iteration: locked D1–D11; recalibrated thresholds; authored
  `IMPLEMENTATION_PLAN.md`, this tracker, and `docs/phases/PHASE-0..8`.
