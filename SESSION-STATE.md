# Session State / Handoff

> Read this first when resuming — especially in a new session or if you're the **other
> developer** picking this up cold. It is written to be self-contained. The running log is
> [CLAUDE.md](CLAUDE.md); the source of truth is
> [docs/REQUIREMENTS-IoTS-3.md](docs/REQUIREMENTS-IoTS-3.md).

**Last updated:** 2026-07-03
**Branch:** `main`
**Environment:** WSL2 + Docker Desktop (Linux).

---

## Where we are

**Iteration 0 (repo init / cleanup) is done.** The repo was seeded from the complete Project 2
codebase and has now been pruned to a **clean, MQTT-only Project 3 base**. No Project 3
components are built yet — that starts next.

### What changed in this pass

- **Deleted** all Project-2-only apparatus: `benchmarks/`, `results/`, `dashboard/`,
  `docker/kafka/`, and **all** P2 docs (old `docs/REQUIREMENTS.md`, `DECISIONS.md`, `report.md`,
  `PLAN.md`, `plan/`, `notes/`, `sr/`).
- **Removed Kafka entirely** for an MQTT-only codebase (adapters, `kafkajs`/`aiokafka`,
  factory branches, `KAFKA_*` env, `acks`/`groupId`). The **thin broker adapter is kept**
  (interfaces + Nest DI + Python mirror), now MQTT-only.
- **Trimmed** `docker-compose.yml` (no more kafka/kafka-ui; project renamed `iots2`→`iots3`) and
  `.env.example` to the MQTT pipeline. **Storage + TimescaleDB are kept** (reused).
- **Added** the three P3 docs under `docs/`; rewrote `README.md`, `CLAUDE.md`, this file.
- **Scaffolded** empty `maas/`, `ekuiper/`, `webapp/` placeholders.

### Decisions locked (owner-confirmed)

1. **MQTT-only, Kafka fully removed** (not left inert).
2. **All P2 docs deleted** — only the three P3 docs remain in `docs/`.
3. **Broker abstraction kept thin** — do not flatten to raw mqtt.js in the services.
4. **Storage + TimescaleDB kept** — reused per REQUIREMENTS §2 (offline training store /
   optional web-app source).

### Verified

- `cd services && npm install && npm run build && npm test` → clean build (4 workspaces),
  broker unit tests **4/4**.
- No `kafka`/`kafkajs` references remain in `services/` or `docker/` (bar one intentional test
  asserting a non-mqtt `BROKER_TYPE` is rejected).
- `docker compose config` parses; the 5 services (timescaledb, mosquitto, ingestion, storage,
  analytics) all resolve under `--profile mqtt --profile app`.
- **Pending on a Docker box:** the end-to-end pipeline run (§ below) — start it to confirm P2
  behaviour is intact after the Kafka removal.

---

## Invariants (do not break)

- **`RAW_TOPIC = sensors/telemetry`** (MQTT). eKuiper and the enhanced Analytics both attach
  to it. eKuiper's output topic is **`sensors/events`** (new).
- **Payload schema:** `ts, device, co, humidity, light, lpg, motion, smoke, temp, seq,
  sent_at_ms` (see [shared/message-contract.md](shared/message-contract.md)). eKuiper stream
  + MaaS features derive from these exactly.
- **Dataset** `data/iot_telemetry_data.csv` (gitignored) — MaaS trains on it.
- `docker/db/init.sql` + `docker/mosquitto/mosquitto.conf` — infra the reused services need.
- `BROKER_TYPE=mqtt` everywhere.

## Confirm the base runs (do this first on a Docker box)

```bash
cp docker/.env.example docker/.env                              # BROKER_TYPE=mqtt
docker compose -f docker/docker-compose.yml --profile mqtt --profile app up -d --build
# Expect: ingestion → sensors/telemetry → storage writes TimescaleDB rows → analytics logs windows
docker compose -f docker/docker-compose.yml logs storage analytics | tail -40
curl -s localhost:3002/stats | python3 -m json.tool            # storage: received/stored/seq integrity
curl -s localhost:3003/stats | python3 -m json.tool            # analytics stats
docker compose -f docker/docker-compose.yml --profile mqtt --profile app down
```

---

## Resume here — Project 3 build order

Per [docs/IoTS-3-EXPLAINED.md](docs/IoTS-3-EXPLAINED.md) §9 (get 1–5 solid first — that's the
graded core):

1. **eKuiper up + one rule.** Add `ekuiper` (`lfedge/ekuiper:2.x-slim`, pinned) to compose,
   MQTT source → `tcp://mosquitto:1883`. Define `sensor_stream` over `sensors/telemetry` and
   one threshold rule → sink `sensors/events`. Provision via REST (`ekuiper/provision.sh`), not
   the UI. Verify: `mosquitto_sub -t sensors/events -v`. Work lands in `ekuiper/`.
2. **Rewire Analytics** to subscribe to `sensors/events` (env `EVENTS_TOPIC`) and log events.
3. **MaaS offline.** `maas/train.py`: load the CSV, lag-window features, chronological
   train/val/test split, `RandomForestRegressor` (temp forecasting recommended), report
   MAE/RMSE/R², `joblib.dump`. Work lands in `maas/`.
4. **Wrap MaaS in FastAPI** (`/predict`, `/health`, `/model/info`) + Dockerfile; ship the
   artifact in the image. Share the feature transform with `train.py` (parity).
5. **Connect Analytics → MaaS** over REST (`MAAS_URL`, timeout + CEP-only fallback) → emit
   enriched `[PREDICTIVE ALERT]` lines.
6. **Add rules 2–3** (windowed + complex/correlation) for depth.
7. **Web app** (`webapp/`) — CEP event feed + predictive alerts + predicted-vs-actual chart.
   Non-blocking (plain HTML + MQTT.js over WS, or Streamlit). Mosquitto WS is on `:9001`.
8. **README + per-microservice descriptions** for the GitHub deliverable.

## Working conventions

- After each feature: summarize, **propose a Conventional-Commits message**
  (`Co-Authored-By: Claude Opus 4.8` trailer), append a `CLAUDE.md` change-log entry, state
  verification, and **update this file**. Commit only when the owner asks.
- Provision eKuiper reproducibly; pin image tags; keep feature-transform parity in MaaS.
- Two developers on this repo — keep this handoff current so the other can resume cold.
