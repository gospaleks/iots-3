# PHASE 5 — Analytics ↔ MaaS integration (core complete)

> Part of `IMPLEMENTATION_PLAN.md`. Read `SESSION_STATE.md` first.
> **This closes the graded core (Phases 1–5).**

## 0. Context to load first
- Read: `IMPLEMENTATION_PLAN.md` §1, §2.2–§2.4, §2.5; `docs/IoTS-3-EXPLAINED.md` §6; Phase 2 & 4 docs.
- Depends on: **Phase 2 DONE** (Analytics consumes events + buffers rollups) and
  **Phase 4 DONE** (MaaS `/predict` live).
- Invariants: feature vector = the buffered rollup history forwarded as-is (D4 — Analytics
  builds no features); MaaS call must be resilient (timeout + CEP-only fallback).

## 1. Goal
Wire Analytics to call MaaS over REST for each event-of-interest, combine the CEP event with the
next-window temperature forecast, emit a human-readable `[PREDICTIVE ALERT]`, and push the
enriched record to the web app over **Socket.IO** (with REST snapshot routes for initial loads).
After this, `docker compose up` runs the whole pipeline end-to-end.

## 2. Entry criteria
- Phases 2 and 4 acceptance passed.
- `.env` has `MAAS_URL`, `MAAS_TIMEOUT_MS`, `LAG_WINDOWS`, `SOCKETIO_CORS_ORIGINS`.

## 3. Steps
1. **Config:** add `MAAS_URL`, `MAAS_TIMEOUT_MS`, `SOCKETIO_CORS_ORIGINS` to `app/config.py`.
2. **HTTP client:** add async `httpx` (or `aiohttp`). On each **event-of-interest** message
   (`HIGH_CO`, later `SUSTAINED_HIGH_TEMP`, `HEAT_DRYING`), read the device's buffered rollup
   history (`deque` from Phase 2). If it has `LAG_WINDOWS` entries, `POST {device, history}` to
   `MAAS_URL/predict` with a `MAAS_TIMEOUT_MS` timeout.
3. **Enrich + log:**
   ```
   [PREDICTIVE ALERT] device=1c:bf:ce:15:ec:4d | eKuiper=SUSTAINED_HIGH_TEMP (avg 26.1°C)
                      | MaaS=next 26.9°C (>25 threshold) | pre-emptive
   ```
4. **Expose to the web app over Socket.IO (replaces the old `ui/alerts` MQTT topic):** mount a
   Socket.IO server on the FastAPI app (Python `python-socketio` ASGI; wrap with
   `socketio.ASGIApp(sio, other_asgi_app=app)` so `/health`, `/stats`, and REST snapshots stay on
   FastAPI and the Socket.IO endpoint lives at `/socket.io`). Use `SOCKETIO_CORS_ORIGINS`.
   Emit two channels to connected browsers:
   - `sio.emit("event", <sensors/events message>)` — relay **every** incoming event (incl.
     `WINDOW_METRICS`) so the app can draw the live feed and the actual-temp line.
   - `sio.emit("alert", <§2.3 payload>)` — the enriched predictive alert (actual avg_temp,
     `forecast_next_avg_temp`, `forecast_available`, `model_version`, `message`).
   Keep a small in-memory ring buffer of recent events/alerts and per-device forecast history, and
   add REST snapshot routes for TanStack Query initial loads:
   `GET /api/events?limit=`, `GET /api/alerts?limit=`, `GET /api/forecast/{device}`.
5. **Resilience (must-have):** wrap the MaaS call in `try/except`/timeout. On failure, still emit
   the CEP-only alert with `forecast_available:false` and `message` noting "prediction unavailable".
   Never let a slow/down MaaS stall the subscribe loop.
6. **Metric (optional):** stamp Analytics receive/decision time to log event-to-alert latency.

## 4. Files created / modified
- `services/analytics-service/app/{config,main}.py` (+ HTTP client module, + Socket.IO server, + REST snapshot routes)
- `services/analytics-service/requirements` (+ `httpx`, `python-socketio`)
- `docker/docker-compose.yml` (analytics depends_on maas; ensure `ml` profile up together; Analytics `:3003` also serves Socket.IO + `/api/*`)

## 5. Acceptance criteria (exit gate)
- [x] For an event-of-interest with a full buffer, Analytics logs `[PREDICTIVE ALERT]` including a MaaS forecast.
      *(verified: `[PREDICTIVE ALERT] device=1c:bf:ce:15:ec:4d-82 eKuiper=SUSTAINED_HIGH_TEMP (avg 25.6°C) | MaaS=next 27.6°C | pre-emptive`)*
- [x] Analytics emits `event` and `alert` over Socket.IO; a connecting client receives them, and `alert` matches §2.3.
      *(verified in the browser: `Socket.IO connected` pill green; alert cards populate live)*
- [x] REST snapshot routes (`/api/events`, `/api/alerts`, `/api/forecast/{device}`) return recent data.
      *(verified: `curl :3003/api/alerts?limit=200` returns 200 alerts in the exact enriched-alert JSON shape)*
- [x] With MaaS stopped, Analytics still emits a CEP-only alert (`forecast_available:false`) and does not hang.
      *(verified: `docker stop iots-maas` → alerts continue with `MaaS=unavailable (prediction unavailable)`, `docker start iots-maas` → forecasts resume)*
- [x] Whole pipeline runs from a single `docker compose up` (mqtt+app+cep+ml profiles).

## 6. How to verify
```bash
docker compose --profile mqtt --profile app --profile ml up -d && \
  docker compose up ekuiper ekuiper-provision -d
docker compose logs -f analytics                 # [PREDICTIVE ALERT] … MaaS=next …
curl -s localhost:3003/api/alerts?limit=5 | jq    # recent enriched alerts (REST snapshot)
# live Socket.IO check (quick):
node -e "const io=require('socket.io-client')('http://localhost:3003');io.on('event',console.log);io.on('alert',console.log)"
docker compose stop maas                          # fallback test
docker compose logs -f analytics                 # CEP-only alert, no hang
```

## 7. Write back to SESSION_STATE.md
- Phase 5 → ✅ DONE; note the enriched-alert format and that fallback works; **core pipeline
  green**; Next → Phase 6 (depth) then Phase 7 (web app).

## 8. Notes / gotchas
- The buffer only fills after `LAG_WINDOWS` windows; early events may have a short history —
  either wait for a full buffer or pad and mark it (document the choice).
- Keep the eKuiper=CEP / Analytics=ML split (D-rationale): don't move the MaaS call into an
  eKuiper REST sink.
