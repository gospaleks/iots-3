# PHASE 8 — Delivery (E2E gate, README, GitHub)

> Part of `IMPLEMENTATION_PLAN.md`. Read `SESSION_STATE.md` first.

## 0. Context to load first
- Read: `IMPLEMENTATION_PLAN.md` §5 (definition of done); `docs/REQUIREMENTS-IoTS-3.md` §9 (deliverables).
- Depends on: **Phase 5 DONE** (core) and **Phase 7 DONE** (web app). Phase 6 strongly recommended.
- Invariants: a fresh clone must come up with **zero manual eKuiper clicks**.

## 1. Goal
Turn the working system into the graded deliverable: a single-command end-to-end run, a README
with an architecture overview and a **short paragraph per microservice**, and a published GitHub
repo with clean history.

## 2. Entry criteria
- Core pipeline green (Phase 5); web app present (Phase 7).

## 3. Steps
1. **Full E2E gate on a clean checkout:**
   ```bash
   git clone <repo> fresh && cd fresh/docker
   cp .env.example .env
   docker compose --profile mqtt --profile app --profile cep --profile ml --profile web up -d
   # then provision eKuiper if not auto-run by profile
   ```
   Confirm: telemetry flows → `sensors/events` shows rollups+events → Analytics logs
   `[PREDICTIVE ALERT]` with forecast → Analytics emits Socket.IO `event`/`alert` (and `/api/*`
   snapshots respond) → web app renders → MaaS `/model/info` ok.
2. **README (root):**
   - One-paragraph project summary + the architecture diagram (`IMPLEMENTATION_PLAN.md` §1).
   - **Per-microservice descriptions** (spec point 5): Ingestion, Storage, eKuiper, MaaS,
     Analytics, Web app — one short paragraph each (role, tech, topics/endpoints).
   - "How to run" (the compose command above) + how to switch window type via `WINDOW_*` env.
   - The ML model card: task, algorithm, features, train/val/test metrics, unit (°C).
3. **Provisioning robustness:** verify `docker compose down && up` re-provisions eKuiper cleanly
   (idempotent `provision.sh`).
4. **Repo hygiene:** ensure `data/iot_telemetry_data.csv` and `node_modules/`, `dist/` are
   gitignored; the MaaS artifact ships in the image (or is built), not required at boot.
5. **Publish:** push to the private GitHub repo `iots-3` with meaningful commit history; confirm
   the per-microservice descriptions render in the README.

## 4. Files created / modified
- `README.md` (root, full rewrite for P3), any final compose/env tidy-ups.

## 5. Acceptance criteria (exit gate — project done)
- [x] Single `docker compose … up` on a fresh clone yields the full working pipeline (no manual UI).
      *(verified: `--profile mqtt --profile app --profile cep --profile ml --profile web up -d` → 9 containers healthy, eKuiper 4/4 rules `running` from the one-shot provisioner, no clicks)*
- [x] README has architecture + a short paragraph per microservice + run guide + model card.
      *(root `README.md` covers all six; `objasnjenje.md` gives the Serbian presentation guide with the same content, mapped to the project brief)*
- [x] `mosquitto_sub -t 'sensors/events'` shows live events; Analytics emits Socket.IO
      `event`/`alert` and `/api/*` snapshots respond; `[PREDICTIVE ALERT]` lines appear in Analytics logs.
      *(verified: SUSTAINED_HIGH_TEMP events on the bus; `curl :3003/api/alerts?limit=200` returns 200 alerts; Analytics logs show `[PREDICTIVE ALERT] … | MaaS=next 27.6°C | pre-emptive`)*
- [x] `curl :maas/model/info` reports train/val/test metrics.
      *(`test R²=0.9877, MAE=0.0726 °C, RMSE=0.4203`)*
- [x] Web app renders event feed, alerts, predicted-vs-actual chart; pipeline runs without it.
      *(verified in the browser + non-blocking test)*
- [x] GitHub repo published; all Phase 0–8 acceptance items ticked in `SESSION_STATE.md`.

## 6. How to verify
- Run the fresh-clone command in §3.1 on a clean machine/dir; walk the §5 checklist.

## 7. Write back to SESSION_STATE.md
- Phase 8 → ✅ DONE; mark **project complete**; record repo URL and the final compose command.

## 8. Notes / gotchas
- Leave the Project 2 Kafka adapter in the repo (shows the abstraction) but keep the demo on MQTT.
- Mention `/docs` (MaaS Swagger) and the eKuiper manager (if used) as inspection aids in the README.
