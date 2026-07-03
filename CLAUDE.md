# CLAUDE.md

Project reference for code agents + running change log. Keep this current — every iteration appends a dated entry so the docs stay cross-referenceable.

## What this project is

Event-driven IoT microservices that **benchmark MQTT (Mosquitto) vs Kafka (KRaft)** across four scenarios (massive ingestion, connectivity failure, burst load, alerting latency). IoTS Project 2.

- **What** to build → [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)
- **Why** the choices → [docs/DECISIONS.md](docs/DECISIONS.md)
- **How / when** to build → [docs/PLAN.md](docs/PLAN.md) (+ [docs/plan/](docs/plan/))

## Architecture in one paragraph

Three services — **ingestion** (NestJS, publisher + device simulator), **storage** (NestJS, subscriber + TimescaleDB writer), **analytics** (FastAPI, tumbling-window alerts). They communicate **only** through the broker. **Zero code duplication:** each service defines a `BrokerAdapter` interface; `MqttAdapter`/`KafkaAdapter` implement it; `BROKER_TYPE` env var selects one at runtime. Docker Compose **profiles** (`mqtt` | `kafka`) select the broker stack. Switching brokers is one CLI flag — no code change.

## Repo layout

```
docs/            REQUIREMENTS, DECISIONS, PLAN (+plan/00–08), notes/ (presentation crib sheet), report
data/            dataset CSV (GITIGNORED)
shared/          dataset_info.md, message-contract.md
services/        npm workspaces: libs/{broker,contracts}, ingestion-service, storage-service, analytics-service (FastAPI)
docker/          docker-compose.yml (profiles), mosquitto/, kafka/, db/init.sql, .env.example
benchmarks/      scenario-{a,b,c,d}.sh, collect-docker-stats.sh, lib/ (parsers)
results/         {mqtt,kafka}/scenario-{a,b,c,d}/
dashboard/       OPTIONAL, last
```

## Conventions

- **Payload / topics:** see [shared/message-contract.md](shared/message-contract.md). Payload = dataset fields + `seq` (per-device counter) + `sent_at_ms` (send time). MQTT topic `sensors/telemetry`, Kafka topic `sensor-telemetry`.
- **DB:** TimescaleDB hypertable on `ts`, PK `(ts, device)`. Schema from `docker/db/init.sql`; TypeORM `synchronize: false`.
- **Broker select:** `BROKER_TYPE` (adapter) + `docker compose --profile <broker>` (infra).
- **Dev tooling:** `--profile tools` adds `kafka-ui` (web UI on `:8080`); add it alongside `--profile kafka`. Dev-only, kept off the benchmark path. MQTT uses external MQTT Explorer (`localhost:1883`). See [docs/notes/02-dev-tooling.md](docs/notes/02-dev-tooling.md).
- **Presentation notes:** append narrative decision/implementation notes to [docs/notes/](docs/notes/) (English, one topic per file) as iterations land — the re-read-before-defense crib sheet.
- **Batch writer:** flush on `BATCH_SIZE` OR `FLUSH_INTERVAL_MS`.
- **Latency:** transport (`receive − sent_at_ms`) + event-to-alert (`alert_log − sent_at_ms`).
- **Load gen:** bench tools for A/C (throughput); NestJS simulator for B/D.
- **Dev env:** WSL2 + Docker Desktop.

## Tech stack

NestJS (mqtt.js, kafkajs, TypeORM) · FastAPI (asyncio-mqtt, aiokafka) · TimescaleDB · Eclipse Mosquitto · Apache Kafka (KRaft) · Docker Compose · emqtt-bench / kafka-producer-perf-test.

## Per-iteration workflow

Each iteration: (1) summarize deliverables, (2) propose a conventional-commit message, (3) append an entry below, (4) state verification. Commit only when the user asks.

---

## Change log

### Iteration 0 — Docs reorg, scaffolding, project reference — 2026-06-02
- `git mv REQUIREMENTS.md DECISIONS.md → docs/` (history preserved).
- **REQUIREMENTS** corrections: §2.3/§2.4 add `seq` + `sent_at_ms`; §2.5 TimescaleDB hypertable + PK `(ts, device)`; §3 TimescaleDB + WSL2 notes; §5.1 `DATA_SOURCE`/`DATASET_PATH`; §5.2 size-OR-time batch flush (`FLUSH_INTERVAL_MS`); §5.3 dual latency metric; §11 unified layout (replaced duplicated `mqtt/`+`kafka/` trees); `BROKER_TYPE` added to all service env tables.
- **DECISIONS** §7 added: refinements (unified structure, load-gen split, measurement enrichment, TimescaleDB, batch flush + WSL2).
- Created `docs/PLAN.md` (index) + `docs/plan/00–08`.
- Created `shared/dataset_info.md` + `shared/message-contract.md`.
- Created `CLAUDE.md`, `README.md`, `.gitignore`, directory skeletons.
- **Verify:** docs render/link; `data/` git-ignored; tree matches REQUIREMENTS §11.
- **Commit:** `docs: reorganize into docs/, define unified architecture + implementation plan` (`add32f2`, pushed)

### Iteration 1 — Infrastructure (DB + brokers + compose profiles) — 2026-06-02 — ✅ verified in WSL2
- `docker/docker-compose.yml`: `name: iots2`; always-on `timescaledb` (`timescale/timescaledb:2.17.2-pg16`, init.sql mounted, healthcheck); profile `mqtt` → `mosquitto` (1883 + 9001 WS); profile `kafka` → `kafka` (`apache/kafka:3.8.1`, KRaft, in-net `kafka:9092` + host `localhost:29092`); `iot-net` bridge + named volumes.
- `docker/db/init.sql`: timescaledb extension, `sensor_data` table (incl. `seq`/`sent_at_ms`), PK `(ts, device)`, `create_hypertable`, `(device, ts DESC)` index.
- `docker/mosquitto/mosquitto.conf`: listeners 1883/9001, persistence on, `persistent_client_expiration 1h`, unlimited queue (Scenario B).
- `docker/.env.example`: full env reference (broker select, DB, Kafka, all three services).
- `docker/kafka/README.md`: KRaft env-config + listeners + cluster-id notes.
- **Static check:** `docker compose config` passes on Windows (syntax/interpolation valid).
- **Verified in WSL2 (2026-06-02):** `cp .env.example .env`. `--profile mqtt up` → timescaledb healthy, mosquitto up; hypertable `sensor_data` present with `seq`/`sent_at_ms`, PK `(ts, device)`, `(device, ts DESC)` + `(ts DESC)` indexes; MQTT pub/sub round-trip on `sensors/telemetry` OK. `--profile kafka up` → broker ready (KRaft); topic `sensor-telemetry` created; in-network produce/consume round-trip OK; **host listener `localhost:29092` reachable from WSL host** (via `--network host` client). Both stacks `down` cleanly.
- **Commit:** `feat(infra): timescaledb hypertable + mosquitto + kafka KRaft via compose profiles` (`d63e393`, pushed)

### Iteration 2 — Shared NestJS libs (BrokerAdapter + contracts) — 2026-06-02 — ✅ verified in WSL2
- `services/package.json`: npm workspaces root (`libs/*`, `ingestion-service`, `storage-service`); root devDeps `typescript`/`tsx`/`@types/node`; scripts `build`/`test`/`smoke`. `tsconfig.base.json` (CommonJS, strict, decorators) + `services/.gitignore`.
- **`@iots/contracts`** (`services/libs/contracts`): `SensorMessage` DTO (mirrors `shared/message-contract.md` incl. `seq`/`sent_at_ms`), topic constants (`MQTT_TOPIC`/`KAFKA_TOPIC`), `ENV_KEYS`. Pure, zero runtime deps.
- **`@iots/broker`** (`services/libs/broker`): `BrokerAdapter` split into `PublisherAdapter.publish` / `SubscriberAdapter.subscribe`; `MessageHandler` gets `ReceivedMeta{topic, receivedAtMs}` for transport latency. `MqttAdapter` (mqtt.js; QoS + `clean:false` persistent session for Scenario B). `KafkaAdapter` (kafkajs; lazy producer/consumer, acks from env, **device key ⇒ per-device partition ordering** for `seq`). `BrokerModule.forRoot()` Nest DI factory → `BROKER_ADAPTER` token, keyed on `BROKER_TYPE` via standalone `createBrokerAdapter` (the only `switch` on broker type). `loadBrokerConfig` derives host/port/topic/qos/acks/groupId defaults per broker.
- **Verified in WSL2 (2026-06-02):** `npm install` (67 pkgs) + `npm run build` clean. `npm test` → 5/5 (factory returns Mqtt/Kafka adapter, rejects bad `BROKER_TYPE`, per-broker defaults, `acks=all`→-1). Integration smoke (`scripts/smoke.ts`) round-trips one message through publish→subscribe against the live Iteration 1 brokers: **MQTT (localhost:1883) ~2ms, Kafka (localhost:29092) ~28ms** transport latency, both exit 0. Fixed a smoke race: prime topic via publish before subscribe so the consumer never hits `UNKNOWN_TOPIC_OR_PARTITION`.
- **Commit:** `feat(libs): BrokerAdapter (mqtt.js/kafkajs) + shared contracts via npm workspaces` (folded into `719f9d7`, pushed)

### Iteration 2.5 — Dev-mode observability tooling + presentation notes — 2026-06-02 — ✅ verified in WSL2
- **Kafka UI** (`docker/docker-compose.yml`): `kafka-ui` service (`ghcr.io/kafbat/kafka-ui:v1.0.0`) behind new **`tools`** profile, on `iot-net`, pointed at `kafka:9092`, web UI on `${KAFKA_UI_PORT:-8080}`. Kept off the benchmark path on purpose (own profile). `.env.example` gains `KAFKA_UI_PORT`. Run: `docker compose --profile kafka --profile tools up -d` → `http://localhost:8080`.
- **MQTT Explorer**: external desktop app (no container by design) → `localhost:1883`. Approved for install; connection settings documented.
- **`docs/notes/`** (new): presentation crib sheet — `README.md` (index), `01-broker-abstraction.md` (the one-flag broker-neutral architecture), `02-dev-tooling.md` (both tools + how to use). English, one topic per file, appended per iteration.
- **Docs updated:** DECISIONS §7.6 (dev tooling rationale), plan/01-infrastructure (tools profile task), CLAUDE.md (repo layout, conventions: `--profile tools` + notes workflow).
- **Verified in WSL2 (2026-06-02):** `docker compose config` OK; `--profile kafka --profile tools up` → kafka-ui serves HTTP 200 on `:8080`, connects to cluster (`status: online`, `brokerCount: 1`). Torn down cleanly. (MQTT Explorer install is user-side.)
- **Commit:** `feat(infra): kafka-ui dev tooling (tools profile) + docs/notes presentation crib sheet` (`0ea06e3`, pushed)

### Iteration 3 — Ingestion Service (NestJS device simulator / publisher) — 2026-06-02 — ✅ verified in WSL2
- **`services/ingestion-service`** (NestJS 10, HTTP app). The only publisher; injects `PublisherAdapter` via `BROKER_ADAPTER` — zero direct broker references.
- **Data sources** (`DATA_SOURCE`): `ReplayDataSource` streams a per-profile sample of the CSV (capped at `REPLAY_SAMPLE_SIZE`/profile via `readline`, bucketed by the 3 real MACs); `RandomDataSource` synthesises values within per-profile ranges. Factory `createDataSource` is the only `switch`. `device-profiles.ts` holds the 3 MACs + ranges.
- **Simulator** (`SimulatorService`): builds `NUM_DEVICES` devices mapped to the 3 profiles round-robin (real MAC 1:1 when ≤3, else `mac-<i>`); 100ms scheduler tick + fractional accumulator drives an exact **total** rate (baseline `NUM_DEVICES × MESSAGES_PER_SECOND`); round-robin publish keeps per-device `seq` ordered; stamps `seq` + `sent_at_ms`. Fire-and-forget publish with `inFlight`/error counters.
- **Rate semantics:** `MESSAGES_PER_SECOND` = per-device; `BURST_TARGET_RATE` = total fleet rate during burst. `triggerBurst(durationSec)` jumps→reverts.
- **Control surface** (`ControlController`, `INGESTION_PORT` 3001): `GET /health`, `GET /stats`, `POST /burst?durationSec=` (so Scenario C scripts can drive bursts).
- **Packaging:** multi-stage `Dockerfile` (context = `services/`), wired into compose under new **`app`** profile (`../data:/data:ro`, `restart: unless-stopped`, control port published). Root `services/package.json` build now includes ingestion; added `start:ingestion`.
- **Verified in WSL2 (2026-06-02):** build clean (3 workspaces). **MQTT** (3 devices, replay): `sensors/telemetry` shows `seq` incrementing per device, realistic per-profile values, current `sent_at_ms`. **Burst:** `/burst` → 6→5000 msg/s (~4.2k in ~1s, 0 errors), auto-revert. **Kafka:** same binary, `BROKER_TYPE=kafka` → identical output on `sensor-telemetry`. **Container:** image builds + runs on `iot-net`, dataset from mounted volume, publishes in-network; graceful SIGTERM shutdown (`enableShutdownHooks`). Note `docs/notes/03-ingestion-service.md`.
- **Commit:** `feat(ingestion): NestJS simulator with burst mode + seq/sent_at_ms over broker adapter` (`af8f5ce`, pushed)

### Iteration 4 — Storage Service (NestJS subscriber → TimescaleDB) — 2026-06-03 — ✅ verified in WSL2
- **`services/storage-service`** (NestJS 10). The only DB writer; injects `SubscriberAdapter` via `BROKER_ADAPTER`. Subscribes, tracks integrity, persists.
- **Write modes** (`WRITE_MODE`): `DIRECT` (one INSERT/msg) and `BATCH` (buffer → flush on `BATCH_SIZE` **OR** `FLUSH_INTERVAL_MS`, single multi-row INSERT). `SensorWriterService` holds the buffer + timer.
- **Idempotent insert:** parameterized multi-row `INSERT … ON CONFLICT (ts, device) DO NOTHING RETURNING 1` → exact inserted count, so `conflicts = attempted − inserted`. `ts` epoch-sec → `TIMESTAMPTZ` via `to_timestamp()`. TypeORM `DataSource` (`synchronize:false`, schema from `db/init.sql`) for the pool + `SensorDataEntity`.
- **Metrics** (`SubscriberService` + `SeqTracker`): per-device `seq` integrity (`missing`/`gaps`/`duplicates`/`outOfOrder`) and transport latency (`receivedAtMs − sent_at_ms`). `ControlController` (`STORAGE_PORT` 3002): `GET /health`, `GET /stats`.
- **Broker lib amendment (`@iots/broker`):** `KafkaAdapter.subscribe` now `admin.createTopics({ waitForLeaders:true })` first (idempotent) so a subscriber starting before any producer can't crash on `UNKNOWN_TOPIC_OR_PARTITION`. Broker unit tests still 5/5.
- **Packaging:** multi-stage `Dockerfile` (context = `services/`); wired into compose under `app` profile with `depends_on: timescaledb (service_healthy)`. `.env.example` gains `STORAGE_PORT`. Root build + `start:storage`.
- **Verified in WSL2 (2026-06-03):** build clean (4 workspaces). **BATCH (MQTT)** 50 dev @ ~500/s: `received(13400)=stored(13000)+conflicts(0)+buffered(400)`, DB==stored, flush chunks of 500, **0 gaps/0 dup/0 OOO**, transport avg **~1.6ms**. **Time-flush:** partial <500 buffer drained on timer after publisher stop. **DIRECT:** flushes=0, stored==received==DB. **ON CONFLICT:** after replay wrap ~3.9k dup `(ts,device)` skipped+counted, arithmetic closed. **Kafka:** storage started subscriber-first (no topic) → no crash (ensure-topic fix), same binary, clean integrity, transport avg **~16ms**. Note `docs/notes/04-storage-service.md`.
- **Commit:** `feat(storage): NestJS subscriber + TimescaleDB writer, direct/batch (size+time flush)` (`cc86404`, pushed)

### Iteration 5 — Analytics Service (FastAPI tumbling window) — 2026-06-03 — ✅ verified in WSL2
- **`services/analytics-service`** (FastAPI, Python 3.12). Subscribe-only; the Python mirror of the broker abstraction — `SubscriberAdapter` ABC + `create_adapter` factory keyed on `BROKER_TYPE`, `MqttAdapter` (**aiomqtt** = renamed asyncio-mqtt) / `KafkaAdapter` (**aiokafka**). Same written contract as `@iots/contracts` (`SensorMessage`, topics) — parity, not duplication.
- **Fan-out:** Kafka uses a distinct consumer group `ANALYTICS_GROUP_ID=iots-analytics` (group B) vs storage's `iots-storage` (group A) so both get the full stream; MQTT fans out natively.
- **Tumbling window** (`WINDOW_SIZE_SEC`, default 10s, fixed/non-overlapping): O(1) running sums; every window logs `[ALERT]`/`[INFO]` per REQUIREMENTS §5.3 format (`avg_temp` vs `ALERT_THRESHOLD`) + a parseable `[LATENCY]` line.
- **Dual latency (Scenario D):** transport (`received_at_ms − sent_at_ms`, per msg) + event-to-alert (`alert_log_ms − sent_at_ms`, per windowed msg). `GET /health`, `GET /stats` on `ANALYTICS_PORT` 3003.
- **Packaging:** `python:3.12-slim` Dockerfile (context = `analytics-service/`), `requirements.txt` (fastapi/uvicorn/aiomqtt/aiokafka); wired into compose under `app` profile. `.env.example` gains `ANALYTICS_GROUP_ID`/`ANALYTICS_PORT`.
- **Verified in WSL2 (2026-06-03):** **MQTT** 30 dev @ 300/s, 3s window → 900 msgs/window exactly; `[ALERT]` (threshold 20, avg temp ~23) and `[INFO]`/OK (threshold 50); transport avg **~3.2ms** vs event-to-alert avg **~1.4s** (transport ≪ event-to-alert as designed). **Kafka** same load: subscriber-first start OK (own group), `[ALERT]` windows, transport avg **~10ms**, event-to-alert ~1.7s. Image builds. Note `docs/notes/05-analytics-service.md`.
- **Commit:** `feat(analytics): FastAPI tumbling window + alerting + dual latency capture` (`279e5b6`, pushed)

### Iteration 6 — Benchmark harness — 2026-06-03 — ✅ verified in WSL2 (A on both brokers; parsers; B/C/D wired)
- **`benchmarks/`** — four scenario runners + `collect-docker-stats.sh` (mandatory `docker stats` baseline → CSV) + `lib/` (pure, unit-tested parsers) + `README.md`. Results land in `results/<broker>/scenario-<x>/` (run outputs gitignored via `results/.gitignore`, structure kept).
- **Load-tool split (DECISIONS §7.2):** A/C raw throughput use mandated bench tools — **emqtt-bench** via `emqx/emqtt-bench` Docker image (ENTRYPOINT is `emqtt_bench`; pass `pub`/`sub` as args; `sub` has no `-L`) and **kafka-producer-perf-test.sh** via `docker exec`. B/D use the NestJS simulator (correlated `seq`/`sent_at_ms`).
- **Scenario A** (`scenario-a-massive-ingestion.sh`): MQTT pub+sub → throughput (peak rate) + loss (sent vs recv); Kafka producer-perf + console-consumer count → throughput/latency + loss; both sample resources.
- **Scenario B** (`scenario-b-…`): `docker network disconnect/connect iots-ingestion`; loss = storage `seq` gap delta, duplicates = `seq` repeats, recovery = reconnect→flow resumes. (Needs `app` profile.)
- **Scenario C** (`scenario-c-…`): `POST /burst` → per-second storage `/stats` timeseries; peak `buffered` backlog, `seq`-gap loss, backlog-drain recovery.
- **Scenario D** (`scenario-d-…`): transport latency from analytics `/stats`; event-to-alert percentiles from window `[LATENCY]` lines; run per QoS/acks.
- **`lib/` parsers:** `parse_emqtt.py`, `parse_kafka_perf.py`, `parse_docker_stats.py` (MiB/GiB→MB), `latency_stats.py` (min/avg/p50/p95/p99/max).
- **Verified in WSL2 (2026-06-03):** all four parsers match hand-checked samples; `bash -n` clean. **Scenario A end-to-end both brokers:** MQTT (50 clients @ 2500 msg/s) → sent=recv=5000, **0% loss**, resources captured (mosquitto ~4MB); Kafka (10k records) → **18k msg/s**, 0% loss, p95 136ms, kafka ~364MB peak 419MB. B/C/D pass syntax + are wired to `/stats`/control ports (full runs in Iteration 7). Note `docs/notes/06-benchmark-harness.md`.
- **Commit:** `feat(benchmarks): scenario A–D runners + docker stats + result parsers` (`c9fcea3`, pushed)

### Iteration 7 — Experiments + report — 2026-06-03 — ✅ done in WSL2
- **Ran the scenario matrix** on both brokers (single WSL2 box). **A**: MQTT QoS 0/1/2 × {100,1000} + Kafka acks 0/1/all × {100,1000} (10000 not run — FD/RAM limits, commands documented). **B/C/D** on both brokers via the `app` stack.
- **Bug fix (`@iots/broker`):** in containers `process.pid` is always 1, so two NestJS services shared an MQTT clientId and Mosquitto evicted the older connection (storage silently received 0). Fix: unique default `clientId` (random suffix) + explicit `CLIENT_ID` env per service in compose (`iots-ingestion`/`iots-storage`). Broker unit tests still 5/5. `scenario-a` summary schema gained `config`/`p95_latency_ms` columns.
- **Key results (`docs/report.md`, §8.4 table filled from CSVs):** throughput Kafka ~130–145k msg/s vs MQTT ~21–70k @1000; **RAM Mosquitto ~4–5MB vs Kafka ~360–580MB (~100×)**; loss ~0 except MQTT QoS2 @1000 (0.53%). **D**: transport MQTT ~1.2ms vs Kafka ~6.7ms; event-to-alert ~5.4–5.6s (window-dominated). **C**: burst 50→5000 absorbed, 0 loss (Kafka backlog 353 vs MQTT 45). **B**: 30s publisher outage → 0 loss both (client buffering/retry; broker-mechanism diff needs subscriber outage / longer partition — noted).
- **Report** (`docs/report.md`): system description, methodology, filled §8.4 table, per-scenario findings, full answers to Critical Questions 1 & 2 (§9), conclusions, reproducibility. Honest scope notes (10000 + subscriber-outage not run).
- **Verified:** every table cell traces to a CSV under `results/` (run outputs gitignored); both critical questions answered with evidence.
- **Commit:** `docs(report): experimental results + MQTT vs Kafka comparative analysis`

### Iteration 8 — Scenario B redesign (subscriber outage + broker mechanism) — 2026-06-04 — ✅ verified in WSL2
- **Problem:** the original Scenario B disconnected the *publisher*; mqtt.js/kafkajs buffer+retry masked the outage, so both brokers scored 0/0 and the broker's offline-delivery mechanism (MQTT persistent-session queue vs Kafka offsets) was never tested. Results looked identical and said nothing.
- **Redesign — disconnect the *subscriber* (`iots-storage`)** so the consumer must *resume*. New `benchmarks/scenario-b-matrix.sh` orchestrates the full grid per broker (recreates ingestion+storage per variant; for MQTT also wipes the broker session store; points `.env`/`mosquitto.conf` at the broker/queue-cap; restores both on exit). Core `scenario-b-connectivity-failure.sh` generalized: `DISCONNECT_TARGET` (storage|ingestion), records `qos/clean_session/max_queued/keepalive_s` columns, waits `/health` + tolerates transient empty `/stats` after reconnect.
- **Keepalive fix (`@iots/broker`):** at 30s outage Mosquitto still believed the client connected (default keepalive 60s ⇒ dead-detect ~90s) and TCP survived the docker net cut, so clean-vs-persistent never diverged. Added `MQTT_KEEPALIVE_SEC` (env-keys + `BrokerConfig.keepaliveSec` + `keepalive` in `MqttAdapter`; default 60, **10** for sub variants). Compose now interpolates `QOS_LEVEL`/`MQTT_CLEAN_SESSION`/`MQTT_KEEPALIVE_SEC` for ingestion+storage. Broker unit tests still 5/5.
- **Bug fix:** matrix `set_broker_env` must also switch `TOPIC` (Kafka rejects `/` in `sensors/telemetry` → `INVALID_TOPIC_EXCEPTION`); now sets `sensor-telemetry` for kafka.
- **Results (~1000 msg/s, storage outage):** **MQTT** persistent(`clean=false`,QoS1,∞)=**0 lost**; clean(`clean=true`)=**31000**; QoS0=**31000**; persistent+`max_queued=10000`=**5884** (RAM queue overflow). **Kafka** 30s=**0 lost/1 dup**, 90s=**0 lost/1 dup** (durable log + offset resume, length-independent; the dup = honest at-least-once, absorbed by `ON CONFLICT`). Publisher-disconnect baseline kept (labelled): 0/0 both (client-masked).
- **Docs:** `docs/report.md` §4 Scenario B rewritten (two variants + subscriber rationale + matrix table), §2/§6 updated, conclusion sharpened; new `docs/notes/07-scenario-b-redesign.md` (+index); `benchmarks/README.md` + `.env.example` updated.
- **Verify:** MQTT + Kafka matrices ran clean end-to-end; every cell traces to a `results/<broker>/scenario-b/summary-<variant>-*.csv`; `.env`/`mosquitto.conf` restored after runs; libs build + broker tests 5/5.
- **Commit:** `feat(benchmarks): Scenario B subscriber-outage matrix + MQTT keepalive knob`

### Iteration 9 — Optional dashboard (thin read-only live monitor) — 2026-06-04 — branch `feat/dashboard`
- **Scope (deliberately de-scoped from `plan/08`):** dropped the proposed NestJS API gateway + WebSocket/SSE + shell-exec scenario triggers. Shipped a **frontend-only, read-only live monitor** + one burst button. Off the benchmark path; requirements coverage untouched. Rationale + decisions in `docs/notes/08-dashboard.md`; `plan/08` updated with an as-built section.
- **`dashboard/`** — Vite + React + TS + **Tailwind v4 + shadcn/ui (Base UI registry, lucide, alias `@`)** scaffolded from the user's shadcn builder preset (`npx shadcn init --preset … --template vite`). Deps: **@tanstack/react-query** (polling + loading/error), **axios**, charts via shadcn **Chart** (Recharts). **No socket.io** — no service speaks WebSocket; `refetchInterval` polling is the realtime path. shadcn skill added under `.agents/skills/`.
- **Data layer:** `lib/{types,api,format}` mirrors the three `/stats` shapes; `hooks/use-dashboard-data` runs the 3 queries + a fixed-clock sampler that derives per-interval **stored rate** (Δstored/Δt) and **transport latency** (Δ(avg·count)/Δcount) into a 60-point rolling buffer; `hooks/use-burst` = mutation → `POST /burst`.
- **UI:** status bar (broker badge + 3 health dots + poll ToggleGroup 1/2/5 s + Trigger burst), 6 stat cards, throughput + transport-latency charts, data-integrity panel (`seq` + conflicts/buffered), latest-window panel (avg temp/humidity/CO + destructive Alert when over threshold). One broker shown at a time (the active `BROKER_TYPE`).
- **Backend change (additive only):** CORS enabled on all three services via `CORS_ORIGINS` (default `*`) — `app.enableCors()` in both NestJS `main.ts`, `CORSMiddleware` in FastAPI `main.py`; documented in `docker/.env.example` (reaches containers via existing `env_file: .env`). Only sets response headers — zero effect on the broker path, measurements, or scripts. NestJS build clean, broker tests still 5/5.
- **Docs:** README gains repo-layout entry + a step-by-step "Optional dashboard (live monitor)" run section (full stack + how to switch broker / repoint / burst / lock CORS); `docs/notes/08-dashboard.md` (+index); `plan/08` as-built note.
- **Verify (this env, no Docker):** `tsc --noEmit`, `npm run build`, `npm run lint` all clean; `vite preview` serves the SPA (HTTP 200, root + bundle). **Live e2e (CORS headers, live data, burst, broker switch, benchmark regression) pending on a WSL2 + Docker box** — exact commands in README.
- **Commit (proposed):** `feat(dashboard): thin read-only live monitor (Vite/React/shadcn) + service CORS`
