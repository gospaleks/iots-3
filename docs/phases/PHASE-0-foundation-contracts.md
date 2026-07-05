# PHASE 0 — Foundation & shared contracts

> Part of `IMPLEMENTATION_PLAN.md`. Read `SESSION_STATE.md` first.
> **Status of record:** see the table in `SESSION_STATE.md`.

## 0. Context to load first
- Read: `IMPLEMENTATION_PLAN.md` §0–§3, `docs/REPO-STATE-2026-07-05_1522.md` (whole).
- Depends on: nothing (this is the entry phase).
- Invariants: everything in `IMPLEMENTATION_PLAN.md` §2.5 and REPO-STATE §8.

## 1. Goal
Prove the reused Project 2 base still runs after the Kafka removal, and freeze the shared
contracts (topics, event payloads, MaaS REST shape, env keys) so all later phases build against
one agreed interface. No new services yet — this is the "solid ground" phase.

## 2. Entry criteria
- Clean MQTT-only base present (REPO-STATE describes it), `git status` clean.
- Docker host available.

## 3. Steps
1. **Bring up the P2 base** and confirm end-to-end still works (this is the pending item from
   REPO-STATE §9):
   ```bash
   cd docker
   cp -n .env.example .env
   docker compose --profile mqtt --profile app up -d
   docker compose logs -f storage      # expect rows written to TimescaleDB
   docker compose logs -f analytics    # expect P2 tumbling-window [ALERT]/[INFO] lines
   ```
2. **Verify the wire unit (D5 check).** With the stack up:
   ```bash
   mosquitto_sub -h localhost -t 'sensors/telemetry' -C 5 -v
   ```
   Confirm `temp` values sit in the **0–30** range (⇒ Celsius, expected). If they are ~32–90
   (⇒ Fahrenheit), record it in `SESSION_STATE.md` "Open items" and note that `train.py`
   (Phase 3) must convert and thresholds (§3) must be rescaled.
3. **Add the shared-contract docs** (so eKuiper/MaaS/Analytics/webapp agree):
   - Update `shared/message-contract.md`: add the `sensors/events` payload (`IMPLEMENTATION_PLAN` §2.2),
     the enriched alert payload (Socket.IO `alert`, §2.3), and the MaaS REST contract (§2.4).
     Note the UI transport: Analytics hosts Socket.IO (`event` + `alert`) + REST snapshots — no MQTT in the browser.
   - Add `shared/thresholds.md`: the recalibrated °C thresholds and env keys (`IMPLEMENTATION_PLAN` §3).
4. **Add the new env keys** to `docker/.env.example` with defaults (do **not** wire them yet):
   ```dotenv
   # --- eKuiper window (Phase 1) ---
   WINDOW_TYPE=tumbling      # tumbling|hopping|sliding|session|count
   WINDOW_UNIT=ss            # ms|ss|mi|hh|dd
   WINDOW_SIZE=10
   WINDOW_STEP=              # hop (hopping) | delay (sliding) | maxDuration (session) | interval (count)
   # --- eKuiper thresholds (Phase 1/6) ---
   TEMP_HIGH=28.0
   CO_HIGH=0.010
   HUMIDITY_LOW=40.0
   SMOKE_HIGH=0.030
   SUSTAINED_TEMP=25.0
   EVENTS_TOPIC=sensors/events
   # --- Analytics ↔ MaaS (Phase 5) ---
   MAAS_URL=http://maas:8000
   MAAS_TIMEOUT_MS=1000
   LAG_WINDOWS=4
   # --- Analytics Socket.IO / web transport (Phase 5/7) ---
   SOCKETIO_CORS_ORIGINS=*    # reuse CORS_ORIGINS if already present
   # --- MaaS (Phase 4) ---
   MODEL_PATH=/models/model.joblib
   MAAS_PORT=8000
   ```
5. **Tear down** and record results.
   ```bash
   docker compose --profile mqtt --profile app down
   ```

## 4. Files created / modified
- `shared/message-contract.md` (extended), `shared/thresholds.md` (new)
- `docker/.env.example` (new keys), `SESSION_STATE.md` (write-back)

## 5. Acceptance criteria (exit gate)
- [ ] P2 base runs: Storage writes rows, Analytics logs windows/alerts, no Kafka errors.
- [ ] Wire unit confirmed and recorded (Celsius expected).
- [ ] Contracts (§2.2–§2.4) and thresholds (§3) committed under `shared/`.
- [ ] New env keys present in `.env.example` with the defaults above.

## 6. How to verify
- `docker compose config` parses with the new env keys.
- `mosquitto_sub -t 'sensors/telemetry' -C 3 -v` shows the raw schema and a plausible temp.

## 7. Write back to SESSION_STATE.md
- Set Phase 0 → ✅ DONE; record wire-unit result; tick the E2E open item; set Next → Phase 1
  (and note Phase 3 can start in parallel).

## 8. Notes / rollback
- Nothing here changes service code, so rollback = revert the doc/env commit.
- If the P2 base does **not** run (Kafka-removal regression), fix that here before Phase 1 —
  every later phase assumes the base pipeline is healthy.
