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
maas/            NEW — MaaS model service + train.py (placeholder; built later)
ekuiper/         NEW — stream + rule definitions + provision.sh (placeholder; built later)
webapp/          NEW — web app (placeholder; built later)
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
