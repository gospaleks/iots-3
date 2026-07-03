# REQUIREMENTS-IoTS-3.md
# Internet of Things and Services — Project 3
## Analytics Enhancement with eKuiper (Streaming/CEP) and a Model-as-a-Service (MaaS) Microservice

> **Purpose of this file:** Single source of truth for Project 3. It extracts every requirement from the Project 3 specification (`IoTS - Projekat 3 - 2026.pdf`) and expresses them in implementation-ready form. Project 3 **builds directly on Project 2**; this document only re-states Project 2 material where Project 3 depends on it.

---

## Table of Contents

1. [Project Goal](#1-project-goal)
2. [Relationship to Project 2 (Foundation)](#2-relationship-to-project-2-foundation)
3. [Scope Change: MQTT-Only Pipeline](#3-scope-change-mqtt-only-pipeline)
4. [New System Architecture](#4-new-system-architecture)
5. [Topics & Message Contracts](#5-topics--message-contracts)
6. [Component Specifications](#6-component-specifications)
   - 6.1 eKuiper — Streaming/CEP Service
   - 6.2 MaaS — Model-as-a-Service Microservice
   - 6.3 Enhanced Analytics Service
   - 6.4 Web/Mobile Application
7. [Machine Learning Model Requirements](#7-machine-learning-model-requirements)
8. [Containerization & Deployment](#8-containerization--deployment)
9. [Deliverables](#9-deliverables)
10. [Repository Structure (delta vs Project 2)](#10-repository-structure-delta-vs-project-2)
11. [Implementation Checklist](#11-implementation-checklist)
12. [Open Questions & Decision Points](#12-open-questions--decision-points)
13. [Verbatim Requirement Mapping](#13-verbatim-requirement-mapping)

---

## 1. Project Goal

Evolve the Project 2 pipeline so that **data analysis is no longer performed by hand-coded logic inside the Analytics service alone**. Instead, the Analytics service must delegate/augment its analysis using two dedicated components:

- **(a) An eKuiper streaming-processing / CEP (Complex Event Processing) engine** that consumes the raw sensor stream over MQTT, applies declarative rules to detect *events of interest*, and republishes those events to a **new MQTT topic**.
- **(b) A MaaS (Model-as-a-Service) microservice** that hosts a trained machine-/deep-learning model and exposes it over **REST**, which the Analytics service calls for prediction (classification or regression) on the sensor time series.

The Analytics service becomes an **orchestrator/consumer**: it receives CEP events from eKuiper and enriches them with ML predictions from MaaS to produce higher-value analytical output (predictive/enriched alerts).

All components run as **Docker containers**; a **web or mobile application** (any technology) visualizes the result; the source code is published on **GitHub** with a short description of each microservice.

---

## 2. Relationship to Project 2 (Foundation)

Project 3 reuses the Project 2 system and extends it. The following Project 2 assets are **carried over unchanged** and must keep working:

| Reused from Project 2 | Role in Project 3 |
|-----------------------|-------------------|
| **Data Ingestion Service (NestJS)** | Still the publisher of raw sensor telemetry to the MQTT broker (device simulator, dataset replay). |
| **Eclipse Mosquitto (MQTT broker)** | The message backbone. eKuiper connects to it as both source and sink. |
| **Data Storage Service (NestJS)** | Still subscribes to the telemetry topic and writes to TimescaleDB. Unchanged. |
| **TimescaleDB** | Historical store; used to **train** the MaaS model offline (source of training data) and, optionally, for the web app. |
| **Message payload schema** (`ts, device, co, humidity, light, lpg, motion, smoke, temp, seq, sent_at_ms`) | The exact JSON the sensor stream carries; eKuiper streams and the MaaS feature set are derived from these fields. |
| **Dataset** (`iot_telemetry_data.csv`, 405,184 rows, 3 devices) | Training/validation/test data for the MaaS model. |

The following Project 2 component is **modified**:

| Modified | Change |
|----------|--------|
| **Analytics Service (FastAPI)** | Stops (or supplements) its self-contained tumbling-window logic. It now (a) subscribes to eKuiper's **event** topic instead of/in addition to the raw topic, and (b) calls the **MaaS REST API** to obtain predictions. See §6.3. |

New components (built for Project 3): **eKuiper service**, **MaaS microservice**, **web/mobile app** (see §6).

### Dataset & Schema (reference — from Project 2 §2)

Message payload (JSON) published on the telemetry topic:

```json
{
  "ts": 1594419195.292461,
  "device": "00:0f:00:70:91:0a",
  "co": 0.0061,
  "humidity": 55.1,
  "light": true,
  "lpg": 0.0089,
  "motion": false,
  "smoke": 0.0240,
  "temp": 31.8,
  "seq": 12345,
  "sent_at_ms": 1717327200123
}
```

Numeric analysis fields: `temp` (°F), `humidity` (%), `co` (ppm), `lpg` (ppm), `smoke` (ppm). Boolean: `light`, `motion`. Three devices with distinct environmental profiles (`00:0f:00:70:91:0a` cool/humid, `1c:bf:ce:15:ec:4d` highly variable, `b8:27:eb:bf:9d:51` warm/dry).

---

## 3. Scope Change: MQTT-Only Pipeline

The Project 3 specification refers **exclusively to the MQTT message broker**. eKuiper is wired to MQTT as both source and sink, and all new inter-component event flow is over MQTT + REST.

- **Kafka is out of scope for Project 3.** The Project 2 Kafka variant/adapter may remain in the repository (it does no harm and demonstrates the abstraction), but Project 3 is developed, run, and demonstrated on the **MQTT profile only**.
- The broker-adapter pattern from Project 2 still applies to the reused services; simply run them with `BROKER_TYPE=mqtt`.

---

## 4. New System Architecture

### 4.1 Dataflow (target state)

```
                         ┌──────────────────────────┐
                         │  Data Ingestion (NestJS)  │   raw sensor telemetry
                         │  device simulator         │
                         └─────────────┬────────────┘
                                       │ PUBLISH  topic: sensors/telemetry
                                       ▼
                         ┌──────────────────────────┐
                         │   Mosquitto (MQTT broker) │
                         └───┬──────────────┬────────┘
             SUBSCRIBE       │              │        SUBSCRIBE (raw)
        sensors/telemetry    │              │        sensors/telemetry
                   ┌─────────▼──┐        ┌──▼────────────────────────┐
                   │  Storage    │        │   eKuiper (Streaming/CEP) │
                   │  (NestJS)   │        │   • MQTT source stream    │
                   │  → Timescale│        │   • SQL rules detect events│
                   └─────────────┘        │   • MQTT sink             │
                                          └──────────┬────────────────┘
                                                     │ PUBLISH topic: sensors/events (NEW)
                                                     ▼
                                          ┌──────────────────────────┐
                                          │   Mosquitto (MQTT broker) │
                                          └──────────┬────────────────┘
                                                     │ SUBSCRIBE sensors/events
                                                     ▼
                    ┌───────────────────────────────────────────────┐
                    │        Analytics Service (FastAPI)             │
                    │  • consumes eKuiper events (1a)                │
                    │  • calls MaaS REST /predict (1b)               │
                    │  • emits enriched / predictive alerts          │
                    └───────────────┬─────────────────────┬─────────┘
                              REST  │ POST /predict        │ (optional) WS/SSE
                                    ▼                      ▼
                    ┌──────────────────────┐   ┌──────────────────────┐
                    │  MaaS (Flask/FastAPI) │   │  Web / Mobile App    │
                    │  ML model + REST      │   │  (any technology)    │
                    └──────────────────────┘   └──────────────────────┘
```

### 4.2 Communication Rules

- **eKuiper input** = the same MQTT topic the Project 2 Analytics service subscribed to (the raw telemetry topic). *(Spec point 2: "eKuiper is subscribed to the same topic on the MQTT broker as Analytics.")*
- **eKuiper output** = a **new** MQTT topic carrying detected events. *(Spec point 2.)*
- **Analytics** subscribes to eKuiper's output topic (event stream), **not** raw telemetry, for its primary input. *(Spec point 1a + 2.)*
- **Analytics → MaaS** communication is **REST only** (HTTP request/response). *(Spec point 1b.)*
- **MaaS never touches the broker.** It is a stateless request/response service. *(Spec point 3.)*
- The web/mobile app reads from Analytics (and/or the broker / TimescaleDB) — implementation's choice.

---

## 5. Topics & Message Contracts

| Topic / Endpoint | Direction | Producer | Consumer(s) | Payload |
|------------------|-----------|----------|-------------|---------|
| `sensors/telemetry` *(raw — the Project 2 topic)* | MQTT | Ingestion | Storage, **eKuiper** | Project 2 sensor JSON (§2) |
| `sensors/events` *(NEW)* | MQTT | **eKuiper (sink)** | **Analytics** | CEP event JSON (§5.1) |
| `POST /predict` | REST | Analytics (caller) | **MaaS** | feature window → prediction (§6.2) |

> Use the **actual raw topic name from your Project 2 implementation** wherever this document says `sensors/telemetry`. Keep the event topic name distinct (e.g. `sensors/events`, `analytics/cep`, or `sensors/alerts`).

### 5.1 eKuiper Event Payload (recommended shape)

Each event eKuiper emits should carry enough context for Analytics to (a) log a meaningful alert and (b) build the MaaS feature vector:

```json
{
  "event_type": "SUSTAINED_HIGH_TEMP",
  "device": "1c:bf:ce:15:ec:4d",
  "window_start": 1594419190.0,
  "window_end": 1594419200.0,
  "avg_temp": 52.4,
  "max_temp": 58.1,
  "avg_humidity": 41.2,
  "avg_co": 0.0071,
  "sample_count": 96,
  "sent_at_ms": 1717327200123
}
```

> The exact fields depend on each rule's `SELECT`. Include the aggregates the ML model needs as input so Analytics can forward them to MaaS without re-buffering raw data.

---

## 6. Component Specifications

### 6.1 eKuiper — Streaming/CEP Service

**Role:** Subscribe to the raw telemetry topic, apply declarative rules to detect events of interest, and publish detected events to a new MQTT topic.

**Image:** `lfedge/ekuiper` (v2.x; `-slim` variant is sufficient). REST management API on port **9081**. Optional management UI `emqx/ekuiper-manager` on **9082**.

#### Functional Requirements

- **MQTT source:** point the default MQTT source at the Mosquitto broker (`MQTT_SOURCE__DEFAULT__SERVER=tcp://mosquitto:1883`, or `etc/mqtt_source.yaml`).
- **Stream definition:** create a stream over the raw telemetry topic, e.g.:
  ```sql
  CREATE STREAM sensor_stream (
      ts BIGINT, device STRING, co FLOAT, humidity FLOAT,
      light BOOLEAN, lpg FLOAT, motion BOOLEAN, smoke FLOAT,
      temp FLOAT, seq BIGINT, sent_at_ms BIGINT
  ) WITH (DATASOURCE="sensors/telemetry", FORMAT="JSON");
  ```
- **Rules (at least 2–3, meaningful):** each rule = SQL logic + an **MQTT sink** action pointing at `sensors/events`. Rules must demonstrate genuine **CEP/stream processing**, not just a single-field filter. Recommended set:
  1. **Threshold event** (simple filter): `temp` or `co`/`smoke` above a limit.
  2. **Windowed aggregation event** (tumbling/hopping/sliding window): sustained condition, e.g. average temp over a window exceeds a threshold.
  3. **Complex event** (optional but valued): rate-of-change / multi-condition correlation (e.g. rising temp **and** low humidity), grouped per `device`.
- **MQTT sink:** every rule publishes its output to the new topic (`sensors/events`), JSON format.
- **Provisioning:** rules and streams should be provisioned reproducibly (init script hitting the REST API, or mounted `etc/` config), **not** created only by hand in the UI — so the stack comes up ready.

#### Example Rule (REST body)

```json
{
  "id": "sustained_high_temp",
  "sql": "SELECT device, AVG(temp) AS avg_temp, MAX(temp) AS max_temp, AVG(humidity) AS avg_humidity, AVG(co) AS avg_co, COUNT(*) AS sample_count, window_start() AS window_start, window_end() AS window_end FROM sensor_stream GROUP BY device, TUMBLINGWINDOW(ss, 10) HAVING AVG(temp) > 50",
  "actions": [
    { "mqtt": { "server": "tcp://mosquitto:1883", "topic": "sensors/events", "sendSingle": true } }
  ]
}
```

### 6.2 MaaS — Model-as-a-Service Microservice

**Role:** Host a trained ML/DL model and expose it over REST for classification/regression on the sensor time series.

#### Functional Requirements

- **Language/framework:** **Python** + **Flask** *or* **FastAPI** (spec allows either).
- **Model:** a machine-/deep-learning model of the team's choice for **classification or regression** applied to the sensor time series (§7). Trained/validated/tested with **scikit-learn** or **TensorFlow / PyTorch (Keras)**.
- **Model loading:** the trained model artifact is loaded once at startup (e.g. `joblib`/`pickle` for scikit-learn, `SavedModel`/`.keras` for TF). Inference must not retrain per request.
- **REST endpoints (minimum):**

| Method & Path | Purpose | Request | Response |
|---------------|---------|---------|----------|
| `POST /predict` | Single prediction | JSON feature vector / recent window | `{ "prediction": ..., "confidence": ..., "model_version": ... }` |
| `GET /health` | Liveness/readiness | — | `{ "status": "ok" }` |
| `GET /model/info` | Model metadata | — | `{ "task", "algorithm", "features", "metrics", "trained_at", "version" }` |

- Optional: `POST /predict/batch` for multiple inputs.
- **Statelessness:** no broker connection, no DB writes required at inference time; pure request/response.
- **Reproducible training:** a training script (`train.py` or notebook) that reads the dataset/TimescaleDB, builds features, trains, evaluates (train/validation/test split), and serializes the model + metrics. Committed to the repo.

#### Required Configuration (env vars — suggested)

| Variable | Description | Example |
|----------|-------------|---------|
| `MODEL_PATH` | Path to serialized model artifact | `/models/model.joblib` |
| `PORT` | HTTP port | `8000` |
| `LOG_LEVEL` | Logging verbosity | `info` |

### 6.3 Enhanced Analytics Service

**Role:** Consume eKuiper's event stream and enrich each event with an ML prediction from MaaS, producing the final analytical output.

#### Functional Requirements

- **Subscribe** to eKuiper's output topic (`sensors/events`) over MQTT (reusing the Project 2 broker adapter). *(1a)*
- For each incoming event, **build a feature vector** (from the event's aggregates and/or a short buffer of recent readings) and **call `POST /predict` on MaaS** over REST. *(1b)*
- **Combine** the CEP event with the ML prediction to emit an **enriched decision/alert**, e.g.:
  ```
  [PREDICTIVE ALERT] {ts} | device={device} | eKuiper=SUSTAINED_HIGH_TEMP (avg 52.4°F)
                      | MaaS forecast next window=54.9°F (>50 threshold, conf 0.83)
                      | → pre-emptive alert
  ```
- Preserve the Project 2 alert-logging discipline (clear `[ALERT]`/`[INFO]` lines) and, if useful, expose alerts to the web app via WS/SSE or by re-publishing to a UI topic.
- Handle MaaS being slow/unavailable gracefully (timeout + fallback to CEP-only alert).

#### Required Configuration (env vars — suggested)

| Variable | Description | Example |
|----------|-------------|---------|
| `BROKER_TYPE` | Broker adapter | `mqtt` |
| `BROKER_HOST` / `BROKER_PORT` | Mosquitto | `mosquitto` / `1883` |
| `EVENTS_TOPIC` | eKuiper event topic | `sensors/events` |
| `MAAS_URL` | MaaS base URL | `http://maas:8000` |
| `MAAS_TIMEOUT_MS` | REST call timeout | `1000` |

### 6.4 Web/Mobile Application

**Role:** Visualize the enhanced pipeline. Technology is **free choice**.

#### Functional Requirements (minimum)

- Show a **live feed of eKuiper CEP events** and **Analytics enriched/predictive alerts**.
- Show **MaaS predictions** (e.g. predicted vs actual, or classification results) for context.
- Optionally show live telemetry and per-device status.

> The Project 2 dashboard was optional and simplified; it may be **replaced** with a fresh, focused app for Project 3 or dropped entirely if a minimal viewer is provided. The app must **not** be a prerequisite for the pipeline to run.

---

## 7. Machine Learning Model Requirements

Per spec point 3, the model must:

- Be a **machine- or deep-learning model** for **classification or regression**.
- Operate on **sensor data streams that form a time series** (`temp`, `humidity`, `co`, `lpg`, `smoke`, plus `device`, `light`, `motion`).
- Be trained, **validated**, and **tested** (proper split) using **scikit-learn** or **TensorFlow/PyTorch (Keras)**.
- Be documented: task, algorithm, feature engineering, metrics.

**Acceptable task framings (choose one):**

| Framing | Task | Target | Notes |
|---------|------|--------|-------|
| **Forecasting** *(recommended primary)* | Regression | Next-window `temp` (or `co`) from a lag window | Cleanest "time series" fit; no manual labels needed. |
| **Anomaly detection** | Classification (or unsupervised) | normal vs anomalous reading/window | Strongest complement to eKuiper's rule-based CEP. |
| **Device identification** | Classification | which of 3 devices | Easy high accuracy (distinct profiles); weaker time-series story. |

See the companion explainer (`IoTS-3-EXPLAINED.md` §MaaS) for the rationale and a concrete build recipe.

---

## 8. Containerization & Deployment

- **Every microservice runs as a Docker container** (spec point 4) and is orchestrated via Docker Compose.
- New/changed compose services: `ekuiper` (+ optional `ekuiper-manager`), `maas`, updated `analytics`, `webapp`.
- Reused services: `mosquitto`, `ingestion`, `storage`, `timescaledb` (MQTT profile).
- eKuiper stream + rules must be **provisioned automatically** on startup (init container / entrypoint script hitting `http://ekuiper:9081`) so `docker compose up` yields a working pipeline.
- MaaS ships the **pre-trained model artifact** in the image (or a mounted volume); the container must not require training at boot.

---

## 9. Deliverables

| # | Deliverable | Description |
|---|-------------|-------------|
| 1 | **GitHub repository** | Complete source with commit history and a **short description of each implemented microservice** (spec point 5). |
| 2 | **Docker Compose configuration** | Brings up the full MQTT pipeline including eKuiper, MaaS, enhanced Analytics, and web app. |
| 3 | **eKuiper stream + rule definitions** | Committed as config/provisioning (SQL + rule JSON), not only created in the UI. |
| 4 | **MaaS model + training script** | Serialized model artifact + reproducible `train.py`/notebook with train/validation/test evaluation and reported metrics. |
| 5 | **Enhanced Analytics service** | Consuming eKuiper events + calling MaaS REST, emitting enriched alerts. |
| 6 | **Web/mobile application** | Visualizing events, predictions, and alerts. |
| 7 | **README / short report** | Architecture overview + how to run + short per-microservice description. |

---

## 10. Repository Structure (delta vs Project 2)

```
/
├── services/
│   ├── ingestion-service/      → REUSED (Project 2)
│   ├── storage-service/        → REUSED (Project 2)
│   └── analytics-service/      → MODIFIED: consume eKuiper events + call MaaS
│
├── maas/                        → NEW
│   ├── app.py                   → Flask/FastAPI REST server (/predict, /health, /model/info)
│   ├── train.py                 → training/validation/testing script
│   ├── models/                  → serialized model artifact (or gitignored + built)
│   ├── requirements.txt
│   └── Dockerfile
│
├── ekuiper/                     → NEW
│   ├── streams/                 → stream definitions (SQL)
│   ├── rules/                   → rule JSON (one per event type)
│   ├── provision.sh             → posts streams+rules to REST API on startup
│   └── mqtt_source.yaml         → (optional) source config
│
├── webapp/                      → NEW (or replaces Project 2 dashboard)
│
├── docker/
│   └── docker-compose.yml       → + ekuiper, (ekuiper-manager), maas, webapp; analytics updated
│
├── data/iot_telemetry_data.csv  → training data (gitignored)
└── README.md                    → + Project 3 microservice descriptions
```

---

## 11. Implementation Checklist

### eKuiper (Streaming/CEP)
- [ ] `ekuiper` container added to Docker Compose, MQTT source → Mosquitto
- [ ] Stream created over the raw telemetry topic (`sensors/telemetry`)
- [ ] Rule 1 — threshold event → MQTT sink `sensors/events`
- [ ] Rule 2 — windowed aggregation event (tumbling/sliding) → `sensors/events`
- [ ] Rule 3 — complex/correlation event (optional) → `sensors/events`
- [ ] Streams + rules provisioned automatically on startup (REST/config, not manual UI only)

### MaaS (Model-as-a-Service)
- [ ] Task chosen (classification or regression) and justified (§7)
- [ ] `train.py` reads dataset, engineers features, trains with train/validation/test split
- [ ] Metrics reported (e.g. MAE/RMSE for regression; accuracy/F1 for classification)
- [ ] Model serialized and loaded once at startup
- [ ] `POST /predict`, `GET /health`, `GET /model/info` implemented (Flask/FastAPI)
- [ ] `maas` container added to Docker Compose

### Enhanced Analytics
- [ ] Subscribes to eKuiper event topic (`sensors/events`)
- [ ] Builds feature vector and calls MaaS `POST /predict` over REST
- [ ] Emits enriched/predictive `[ALERT]`/`[INFO]` output
- [ ] Graceful handling of MaaS timeout/unavailability

### Web/Mobile App
- [ ] Live CEP event feed
- [ ] Analytics enriched alert feed
- [ ] MaaS prediction display
- [ ] App is optional to the pipeline (not a runtime dependency)

### Delivery
- [ ] `docker compose up` brings up the whole MQTT pipeline working end-to-end
- [ ] GitHub repo published with per-microservice descriptions
- [ ] README with architecture + run instructions

---

## 12. Open Questions & Decision Points

1. **"Data Storage Service publishes data" wording (spec point 1).** The Project 3 text describes Analytics as *"subscribed to a topic on the MQTT broker to which the Data Storage Service publishes data."* In the actual Project 2 architecture the **Ingestion** service is the publisher and Storage is subscriber-only. This mismatch is immaterial to Project 3's mechanics: what matters is that **eKuiper and Analytics attach to whatever topic carries the raw sensor data** (spec point 2 anchors eKuiper to "the same topic as Analytics"). **Recommendation:** keep the Project 2 topology (Ingestion publishes; Storage + eKuiper subscribe) and treat the wording as a loose description. If the professor insists on Storage being the literal publisher, add a thin re-publish from Storage — but this is not otherwise required.

2. **Where the ML call lives.** The spec assigns MaaS consumption to **Analytics** (point 1b), so the REST call to MaaS belongs in Analytics, **not** in an eKuiper REST sink. (eKuiper *can* call REST, but keep the division: eKuiper = CEP, Analytics = ML orchestration.)

3. **Does Analytics keep its Project 2 tumbling window?** Optional. eKuiper can take over windowing/aggregation; Analytics can then be thin. Keeping a light window in Analytics is acceptable if useful for feature building.

4. **Feature source for MaaS.** Either (a) eKuiper emits the feature aggregates in the event (thin Analytics — recommended), or (b) Analytics also buffers raw readings per device. Pick one and document it.

5. **ML task choice.** Pick from §7. Recommended default: **temp/CO forecasting (regression)**; strongest CEP complement: **anomaly classification**.

6. **Web app scope.** Fresh minimal app vs reusing the simplified Project 2 dashboard. Either is fine; keep it non-blocking.

---

## 13. Verbatim Requirement Mapping

| Spec point (PDF) | Where addressed |
|------------------|-----------------|
| 1 — Enhance Analytics to use (a) eKuiper CEP via MQTT and (b) MaaS REST | §1, §4, §6.1, §6.2, §6.3 |
| 2 — eKuiper subscribes to the same topic as Analytics, detects events by rules, publishes to a new MQTT topic that Analytics consumes | §4.2, §5, §6.1, §6.3 |
| 3 — MaaS in Python + Flask/FastAPI with an ML/DL model (classification/regression) on the sensor time series; train/validate/test with scikit-learn or TF/PyTorch(Keras); web tutorials | §6.2, §7 |
| 4 — Microservices as Docker containers; web/mobile app in arbitrary tech | §6.4, §8 |
| 5 — Source on GitHub with short microservice descriptions | §9 |

---

*Source: `IoTS - Projekat 3 - 2026.pdf`; foundation from Project 2 `REQUIREMENTS.md` / `DECISIONS.md` / `report.md`. eKuiper details verified against current `lfedge/ekuiper` documentation.*
