# HANDOFF-repo-init-cleanup.md
## Context for a Claude Code session — initializing the `iots-3` repo from Project 2 and pruning it to a clean Project 3 base

> **As executed (2026-07-03):** this pass deviated from the conservative defaults below on three points, per the repo owner: (1) **Kafka was removed entirely** (adapters, deps, factory branches — not left inert as §6 suggests), (2) **all Project 2 docs were deleted** (no `docs/project-2/` archive — only the three P3 docs remain in `docs/`), and (3) the `maas/ ekuiper/ webapp/` placeholders were scaffolded. See `SESSION-STATE.md` and `CLAUDE.md` for the actual as-built state. The rest of this document is the original cleanup contract, kept for reference.

> **Read this first, agent.** You are working in a **fresh private repo `iots-3`** that has just been seeded with the **complete Project 2 codebase**. Your job in *this* pass is narrow: **remove everything that belongs only to Project 2 so that what remains is a clean foundation to build Project 3 on.** You are NOT building the new Project 3 components in this pass (that comes later). Companion docs in this repo: `REQUIREMENTS-IoTS-3.md` (the "what" of Project 3) and `IoTS-3-EXPLAINED.md` (the "how"). This file is only the cleanup contract.

---

## 0. The golden rule

**The three reused services must still run after cleanup.** So:

- **Deleting whole standalone Project-2-only directories** (benchmarks, results, dashboard, Kafka broker config, process notes) **cannot break the running services** — do these freely and confidently.
- **Editing the internals of working services** (e.g. ripping the Kafka adapter out of shared libs) **can** introduce regressions. Treat that as *optional/deferred* (see §6), not part of the required pass.

When in doubt: remove standalone artifacts, leave working code alone, and verify at the end (§9).

---

## 1. Is "init from Project 2, then prune" the right approach?

Yes — it's the correct move. Two notes to be aware of:

1. **Git history.** Seeding a fresh repo gives you a **clean history that starts at Project 3**, which is appropriate — Project 3 is its own graded deliverable. If preserving Project 2's commit history mattered you'd clone the P2 repo instead; for a fresh private `iots-3`, a clean start is simpler and recommended.
2. **Reuse-then-extend, not rewrite.** The point of importing P2 is that **Ingestion, Storage, TimescaleDB, Mosquitto, and the message contract are reused unchanged**, and **Analytics is modified** (not rewritten). Cleanup must protect exactly those assets.

---

## 2. Target end-state (what the tree should look like after this pass)

```
iots-3/
├── docs/
│   ├── REQUIREMENTS-IoTS-3.md      ← P3 requirements (already added)
│   ├── IoTS-3-EXPLAINED.md         ← P3 explainer (already added)
│   ├── HANDOFF-repo-init-cleanup.md← this file
│   └── project-2/                  ← P2 foundation docs kept for reference
│       ├── REQUIREMENTS.md
│       └── DECISIONS.md
│
├── data/
│   └── iot_telemetry_data.csv      ← KEEP (gitignored) — MaaS training data
│
├── shared/
│   ├── dataset_info.md             ← KEEP
│   └── message-contract.md         ← KEEP (canonical payload + topic names)
│
├── services/
│   ├── package.json                ← KEEP
│   ├── libs/
│   │   ├── broker/                 ← KEEP (MQTT adapter; Kafka impl may stay inert — §6)
│   │   └── contracts/              ← KEEP
│   ├── ingestion-service/          ← KEEP (reused)
│   ├── storage-service/            ← KEEP (reused)
│   └── analytics-service/          ← KEEP (will be MODIFIED in a later pass)
│
├── docker/
│   ├── docker-compose.yml          ← KEEP, TRIMMED to MQTT-only (§5)
│   ├── .env.example                ← KEEP, TRIMMED (§5)
│   ├── mosquitto/mosquitto.conf    ← KEEP
│   └── db/init.sql                 ← KEEP (TimescaleDB schema)
│
├── .gitignore                      ← KEEP
└── README.md                       ← KEEP but rewrite for P3

# Placeholders you MAY scaffold now (empty, optional — see §7):
├── maas/            (NEW, built later)
├── ekuiper/         (NEW, built later)
└── webapp/          (NEW, built from scratch later)
```

Everything not in this tree from §4 should be removed.

---

## 3. KEEP — do not delete

| Path | Why it stays |
|------|--------------|
| `services/ingestion-service/` | Reused — the raw-telemetry publisher (device simulator / dataset replay). |
| `services/storage-service/` | Reused — subscriber → TimescaleDB writer. |
| `services/analytics-service/` | Reused, to be **modified** for P3 (consume eKuiper events + call MaaS). Do not gut it now. |
| `services/libs/broker/` | The MQTT adapter lives here — Analytics/Ingestion/Storage depend on it. |
| `services/libs/contracts/` | Payload DTO, topic constants, env keys — the shared contract. |
| `services/package.json` | npm workspaces root for the NestJS services. |
| `docker/docker-compose.yml` | Reused, trimmed to MQTT-only (§5). |
| `docker/.env.example` | Reused, trimmed (§5). |
| `docker/mosquitto/mosquitto.conf` | The MQTT broker config — eKuiper connects here. |
| `docker/db/init.sql` | TimescaleDB extension + hypertable + PK. Storage needs it; training data source. |
| `data/iot_telemetry_data.csv` (gitignored) | **Training/validation/test data for the MaaS model.** Critical — do not remove. |
| `shared/message-contract.md` | Canonical payload + topic names — the eKuiper stream schema and MaaS features derive from this. |
| `shared/dataset_info.md` | Dataset schema reference for MaaS feature engineering. |
| P2 `REQUIREMENTS.md` + `DECISIONS.md` | Foundation reference (move under `docs/project-2/`). The P3 docs cite them. |
| `.gitignore` | Keeps the dataset CSV and build artifacts out of git. |
| `README.md` | Keep the file; rewrite content for P3 (§10). |

---

## 4. REMOVE — safe deletions (standalone Project-2-only, zero regression risk)

These are entirely Project 2's broker-comparison apparatus and process artifacts. None is referenced by the reused services at runtime.

| Path | What it was (P2) | Action |
|------|------------------|--------|
| `benchmarks/` | Scenario A–D shell scripts, `scenario-b-matrix.sh`, `collect-docker-stats.sh`, `lib/` parsers, `benchmarks/README.md` | **Delete whole dir** |
| `results/` | Raw P2 measurement CSVs (`mqtt/…`, `kafka/…`) | **Delete whole dir** |
| `dashboard/` | The optional, presentation-only P2 dashboard (NestJS api-gateway + React UI) | **Delete whole dir** — P3 gets a brand-new app built from scratch |
| `docker/kafka/` | Kafka KRaft config/env | **Delete whole dir** — P3 is MQTT-only |
| `notes/` | P2 narrative notes (broker abstraction, dev tooling, benchmark harness, scenario-B redesign, etc.) | **Delete whole dir** |
| `docs/report.md` | P2 technical report (a P2 deliverable) | **Delete** (or archive under `docs/project-2/` if you want to keep it) |
| `docs/PLAN.md` | P2 implementation plan | **Delete** |
| `docs/plan/` | P2 per-iteration plan files (00–08) | **Delete whole dir** |
| `CLAUDE.md` | P2 project reference + P2 change log | **Delete** (a fresh P3 `CLAUDE.md` can be created later if wanted) |

**Suggested commands (adjust paths to the actual tree — run `git ls-files | sed 's#/.*##' | sort -u` and `ls` first to confirm names):**

```bash
git rm -r benchmarks results dashboard docker/kafka notes docs/plan
git rm docs/report.md docs/PLAN.md CLAUDE.md
mkdir -p docs/project-2
git mv docs/REQUIREMENTS.md docs/project-2/REQUIREMENTS.md
git mv docs/DECISIONS.md    docs/project-2/DECISIONS.md
```

---

## 5. TRIM — config edits (low risk, but they touch files)

### 5.1 `docker/docker-compose.yml`
- **Remove** the Kafka broker service and the Kafka UI service (`kafka-ui` / `kafbat/kafka-ui`, the `tools` profile).
- **Remove** the `kafka` profile; keep the services the MQTT pipeline needs: TimescaleDB (always-on/`db`), `mosquitto`, `ingestion`, `storage`, `analytics` (under the existing `mqtt` / `app` profiles).
- Leave room to add (later, not now): `ekuiper`, optional `ekuiper-manager`, `maas`, `webapp`.
- After editing, `docker compose config` must parse with **no references to removed services**.

### 5.2 `docker/.env.example`
- **Remove** Kafka-only vars (`KAFKA_ACKS`, any Kafka host/port, Kafka-UI vars).
- **Keep** `BROKER_TYPE` (set default `mqtt`), `BROKER_HOST`/`BROKER_PORT` (mosquitto/1883), `TOPIC`, DB URL, Storage `WRITE_MODE`/`BATCH_SIZE`/`FLUSH_INTERVAL_MS`, Analytics `WINDOW_SIZE_SEC`/`ALERT_THRESHOLD`.
- (P3 will later add: `EVENTS_TOPIC`, `MAAS_URL`, `MAAS_TIMEOUT_MS`, eKuiper/MaaS vars — don't add them in this pass.)

### 5.3 `.gitignore`
- Confirm `data/*.csv` (or the dataset path) stays ignored. Add `maas/models/*.joblib` etc. later when those exist.

---

## 6. OPTIONAL deeper cleanup (defer unless explicitly asked — higher regression risk)

The services currently run with `BROKER_TYPE=mqtt`, which means the **Kafka adapter code is already inert** (never instantiated). So the following is *cosmetic tidiness*, not a functional requirement, and it edits shared/working code:

- Remove the `KafkaAdapter` implementation from `services/libs/broker/` and the Kafka branch in the adapter DI factory.
- Remove `kafkajs` (NestJS) and `aiokafka` (Analytics `requirements.txt`) dependencies.
- Remove the Python Kafka adapter in `analytics-service`.

**Recommendation:** *leave this for a later, deliberate commit* (or skip entirely). Ripping broker code out of three services for zero functional gain is exactly the kind of change that silently breaks a working pipeline the night before a demo. The `REQUIREMENTS-IoTS-3.md` §3 explicitly says the Kafka adapter *may remain* — it does no harm and even showcases the abstraction. If you do it, do it in isolation and re-run §9 verification immediately.

> *(As executed here, the repo owner opted into this deeper cleanup — Kafka was removed entirely and verified against §9.)*

**Do NOT remove these (they look P2-specific but are harmless/useful for P3):**
- `seq` and `sent_at_ms` payload fields — keep; part of the message contract, and `sent_at_ms` is still useful.
- Ingestion burst-mode / `DATA_SOURCE=replay|random` — keep; harmless, and replay is how you generate a live stream for the P3 demo.

---

## 7. What NOT to build in this pass (scope guard)

This pass is **prune + verify only**. Do **not** implement in this session:
- the eKuiper service, its streams/rules, or provisioning,
- the MaaS service or training script,
- the Analytics rewrite (event subscription + MaaS REST call),
- the new web app.

Those are separate later iterations, specified in `REQUIREMENTS-IoTS-3.md` §6 and `IoTS-3-EXPLAINED.md`.

**Optional, allowed:** scaffold empty placeholder dirs `maas/`, `ekuiper/`, `webapp/` (each with a one-line `README.md` or `.gitkeep`) so the target structure is visible in the tree. Nothing more.

---

## 8. Invariants to preserve (breaking any of these breaks Project 3)

1. **The raw telemetry topic name** the Ingestion service publishes to — eKuiper and the new Analytics both attach to it. **Record the actual name** (check `services/libs/contracts` / `.env.example` / `message-contract.md`) and note it at the top of the README, e.g. `RAW_TOPIC = sensors/telemetry`. Do not rename it.
2. **The message contract** (`shared/message-contract.md`) and payload schema (`ts, device, co, humidity, light, lpg, motion, smoke, temp, seq, sent_at_ms`) — the eKuiper stream definition and MaaS features derive from these fields exactly.
3. **The dataset** (`data/iot_telemetry_data.csv`, gitignored) — MaaS trains on it.
4. **TimescaleDB `init.sql`** and **`mosquitto.conf`** — infra the reused services depend on.
5. **`BROKER_TYPE=mqtt`** everywhere — Project 3 runs the MQTT profile only.

---

## 9. Verification gate (must pass before committing the cleanup)

1. **Pipeline still works (P2 behavior intact):**
   ```bash
   cp docker/.env.example docker/.env      # BROKER_TYPE=mqtt
   docker compose --profile mqtt --profile app up -d
   ```
   Expect: Ingestion publishes telemetry → Storage writes rows to TimescaleDB → Analytics logs `[ALERT]`/`[INFO]` lines. Confirm rows are landing (`docker compose logs storage`, or query the DB) and Analytics is emitting window summaries.
2. **No dangling references to removed things:**
   ```bash
   grep -ri "kafka"      docker/ services/ --exclude-dir=node_modules   # only inert adapter code (if kept), no compose/service wiring
   grep -ri "benchmark\|scenario\|dashboard" . --exclude-dir=node_modules --exclude-dir=.git
   docker compose config >/dev/null        # compose parses cleanly
   ```
   Any hit that points at a *deleted* file must be cleaned up.
3. **Tree matches §2.** No `benchmarks/`, `results/`, `dashboard/`, `docker/kafka/`, `notes/`, `docs/plan/`, `docs/report.md`, `docs/PLAN.md`, `CLAUDE.md` remain.

If (1) fails, you removed or edited something load-bearing — revert the last change and re-check.

---

## 10. Suggested commit sequence

1. `chore: import Project 2 codebase (baseline)` — the untouched seed (so you can always diff against it).
2. `chore: remove Project 2-only artifacts (benchmarks, results, dashboard, kafka, notes, process docs)` — §4.
3. `chore: trim compose + env to MQTT-only pipeline` — §5.
4. `docs: add Project 3 requirements, explainer, and this handoff; archive P2 docs under docs/project-2` — move the three P3 docs into `docs/`, relocate P2 `REQUIREMENTS.md`/`DECISIONS.md`.
5. `docs: rewrite README for Project 3` — new architecture summary (eKuiper + MaaS + enhanced Analytics + webapp), the reused-vs-new table, the recorded `RAW_TOPIC`, and a "run" section (currently just the reused MQTT pipeline; expand as components land).
6. *(optional)* `chore: scaffold maas/ ekuiper/ webapp/ placeholders` — §7.

After this, the repo is a clean, runnable P2-derived base and the next sessions can build eKuiper, MaaS, the Analytics enhancement, and the new web app on top, per `REQUIREMENTS-IoTS-3.md`.

---

*Companion to `REQUIREMENTS-IoTS-3.md` and `IoTS-3-EXPLAINED.md`. This document governs only the repo-initialization cleanup pass.*
