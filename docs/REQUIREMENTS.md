# REQUIREMENTS.md
# Internet of Things and Services — Project 2
## Event-Driven IoT Microservices: Comparative Evaluation of MQTT and Kafka

> **Purpose of this file:** Single source of truth for the entire project. Every code agent, service implementation, and benchmark script must reference this document. Mark items in the checklist as they are completed.

---

## Table of Contents

1. [Project Goal](#1-project-goal)
2. [Dataset — Source of Truth](#2-dataset--source-of-truth)
3. [Technology Stack](#3-technology-stack)
4. [System Architecture](#4-system-architecture)
5. [Service Specifications](#5-service-specifications)
6. [Message Broker Implementations](#6-message-broker-implementations)
7. [Experimental Scenarios](#7-experimental-scenarios)
8. [Performance Measurement](#8-performance-measurement)
9. [Reliability Analysis](#9-reliability-analysis)
10. [Deliverables](#10-deliverables)
11. [Repository Structure](#11-repository-structure)
12. [Implementation Checklist](#12-implementation-checklist)

---

## 1. Project Goal

Investigate the **performance, scalability, and limitations** of different message broker systems based on the **publish-subscribe model** within IoT microservice architectures.

### Research Focus

- Understanding **trade-off decisions**: latency vs. reliability
- Suitability of broker systems for **edge environments** (constrained resources)
- Suitability of broker systems for **cloud environments** (scalability, analytics)

### Foundation

- Reuse the **IoT dataset and data model from Project 1** (extension of attributes is allowed)
- The entire system must be **containerized** using Docker Compose
- At least **two different backend technologies** must be used

---

## 2. Dataset — Source of Truth

### 2.1 Overview

| Property         | Value                                               |
|------------------|-----------------------------------------------------|
| Name             | Environmental Sensor Telemetry Data                 |
| Origin           | Three Raspberry Pi + Breadboard sensor arrays       |
| Total Rows       | 405,184                                             |
| Time Range       | 07/12/2020 – 07/19/2020                             |
| Original Protocol| MQTT                                                |

### 2.2 Device Metadata

| Device ID (MAC)         | Environmental Condition               |
|-------------------------|---------------------------------------|
| `00:0f:00:70:91:0a`     | Stable, cooler, and more humid        |
| `1c:bf:ce:15:ec:4d`     | Highly variable temperature/humidity  |
| `b8:27:eb:bf:9d:51`     | Stable, warmer, and dryer             |

### 2.3 Data Schema — `sensor_data` table

| Column       | SQL Type       | Protobuf Type  | Description             | Unit/Format    |
|--------------|----------------|----------------|-------------------------|----------------|
| `ts`         | `TIMESTAMPTZ`  | `double`       | Event timestamp         | Epoch seconds  |
| `device`     | `VARCHAR(255)` | `string`       | Device MAC address      | String         |
| `co`         | `FLOAT8`       | `double`       | Carbon Monoxide level   | ppm (%)        |
| `humidity`   | `FLOAT8`       | `double`       | Relative Humidity       | percentage     |
| `light`      | `BOOLEAN`      | `bool`         | Light detected?         | boolean        |
| `lpg`        | `FLOAT8`       | `double`       | Liquid Petroleum Gas    | ppm (%)        |
| `motion`     | `BOOLEAN`      | `bool`         | Motion detected?        | boolean        |
| `smoke`      | `FLOAT8`       | `double`       | Smoke level             | ppm (%)        |
| `temp`       | `FLOAT8`       | `double`       | Temperature             | Fahrenheit     |
| `seq`        | `BIGINT`       | `int64`        | Per-device monotonic counter (loss/duplicate detection) | integer |
| `sent_at_ms` | `BIGINT`       | `int64`        | High-res wall-clock send time (latency measurement)     | epoch ms |

> **Measurement fields (`seq`, `sent_at_ms`) added per the "extension of attributes is allowed" clause (§1).** `seq` is a per-device monotonically increasing counter that lets the Storage Service detect lost/duplicated messages via gap analysis. `sent_at_ms` is the wall-clock send time — **distinct from `ts`** (which is the dataset *event* time); it is the basis for end-to-end latency. Both are persisted so post-run analysis can be done against the DB as well as the logs.

### 2.4 Message Payload (JSON)

```json
{
  "ts": 1594419195.292461,
  "device": "00:0f:00:70:91:0a",
  "co": 0.006104480269226063,
  "humidity": 55.099998474121094,
  "light": true,
  "lpg": 0.008895956948783413,
  "motion": false,
  "smoke": 0.023978358312270912,
  "temp": 31.799999237060547,
  "seq": 12345,
  "sent_at_ms": 1717327200123
}
```

### 2.5 Database Implementation Notes

- **Storage engine: TimescaleDB** (PostgreSQL + time-series extension). `sensor_data` is a **hypertable** partitioned on `ts` for time-series write/query performance.
- **Primary key: composite `(ts, device)`** — NOT `ts` alone. The three devices can emit the same `ts`, so `ts` alone would collide. TimescaleDB additionally requires the partitioning column (`ts`) to be part of any unique key, so `(ts, device)` is the natural choice.
- `ts` is stored as Epoch float in the dataset — implementation must convert to `TIMESTAMPTZ` on insert.
- `light` and `motion` are `BOOLEAN`; `co`/`humidity`/`lpg`/`smoke`/`temp` are `FLOAT8`; `seq`/`sent_at_ms` are `BIGINT`.
- Schema is created by `docker/db/init.sql` (extension + table + `create_hypertable`). The Storage Service runs TypeORM with `synchronize: false` — it must **not** manage the schema (TypeORM cannot create hypertables).
- Primary aggregation metrics for window analytics: **`temp`**, **`humidity`**, **`co`**

### 2.6 Alert Threshold (Analytics)

| Metric       | Alert Threshold | Unit        |
|--------------|-----------------|-------------|
| `temp`       | > 50 (default)  | Fahrenheit  |
| `co`         | configurable    | ppm         |
| `smoke`      | configurable    | ppm         |

---

## 3. Technology Stack

### 3.1 Backend Services — Two Technologies Required

| Service               | Technology      | Rationale                                                                 |
|-----------------------|-----------------|---------------------------------------------------------------------------|
| Data Ingestion Service| **NestJS**      | Native async/event-loop ideal for high-throughput publishing; MQTT.js + KafkaJS well-supported |
| Data Storage Service  | **NestJS**      | TypeORM + PostgreSQL integration; batch write patterns well-supported      |
| Analytics Service     | **FastAPI**     | Python ecosystem: `statistics`, `asyncio`, `aiokafka`, `asyncio-mqtt`; best fit for stream processing with rolling aggregations |

> **Why FastAPI over .NET as the second technology:**
> The Analytics Service performs continuous stream processing, tumbling window aggregations, and statistical calculations. Python's standard library and async ecosystem (`asyncio`, `statistics`, `aiokafka`, `asyncio-mqtt`) map directly to these requirements with minimal boilerplate. .NET would bring superior runtime performance but adds unnecessary framework weight for a service whose bottleneck is broker I/O, not CPU.

### 3.2 Infrastructure

| Component        | Technology                                |
|------------------|-------------------------------------------|
| Containerization | Docker Compose (mandatory)                |
| Database         | **TimescaleDB** (PostgreSQL + time-series extension) |
| Broker A         | Eclipse Mosquitto (MQTT)                  |
| Broker B         | Apache Kafka — KRaft mode (no ZooKeeper)  |
| Load Testing     | emqtt-bench / kafka-producer-perf-test.sh |
| Resource Monitoring | `docker stats` (+ optional Prometheus + Grafana) |
| Dev Environment  | **WSL2** + Docker Desktop (Linux-native bench tools and shell scripts) |

> **Why TimescaleDB instead of plain PostgreSQL?** The dataset is time-series and Scenarios A/C generate high-rate inserts. TimescaleDB's hypertable (automatic time-based partitioning into chunks) keeps inserts and `ts`-range queries fast, and provides `time_bucket()` for post-run analysis. It is a drop-in `postgres`-compatible image — the Storage Service connects with the standard `pg` driver. The composite PK `(ts, device)` also resolves the `ts`-collision problem (see §2.5).

> **Why develop in WSL2?** The repo lives in git and Docker Desktop integrates with WSL2, so development happens in a Linux userland. The mandated load-test tools (emqtt-bench is Erlang-based; k6 broker extensions are built with Go/xk6) and the benchmark `.sh` scripts all run natively there — avoiding win32 friction without having to containerize the bench tools purely for OS reasons.

> **Why KRaft mode for Kafka?** Running Kafka without ZooKeeper eliminates one container from the stack, reducing local machine memory consumption. This is a pragmatic decision for dev/test environments — KRaft is production-ready as of Kafka 3.3+.

---

## 4. System Architecture

### 4.1 Logical Architecture

The system is implemented **twice** — once with MQTT and once with Kafka. Both variants share the same three service roles; only the transport layer changes.

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Compose Stack                      │
│                                                             │
│  ┌─────────────────────┐                                    │
│  │  Data Ingestion Svc │  (NestJS)                         │
│  │  [IoT Simulator]    │                                    │
│  └──────────┬──────────┘                                    │
│             │  PUBLISH                                       │
│             ▼                                               │
│  ┌──────────────────────────┐                              │
│  │      Message Broker      │                              │
│  │  (Mosquitto / Kafka KRaft)│                             │
│  └───────────┬──────────────┘                              │
│              │  SUBSCRIBE (fan-out)                         │
│     ┌────────┴────────┐                                     │
│     ▼                 ▼                                     │
│  ┌──────────┐   ┌──────────────────┐                       │
│  │ Storage  │   │ Analytics Service│  (FastAPI)            │
│  │  Svc     │   │ [Stream Process] │                       │
│  │ (NestJS) │   └──────────────────┘                       │
│  └────┬─────┘                                               │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────┐                                               │
│  │PostgreSQL│                                               │
│  └──────────┘                                               │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Communication Rules

- All inter-service communication goes **exclusively through the broker** — no direct HTTP calls between services during real-time operation
- The Ingestion Service is the **only publisher**
- Storage Service and Analytics Service are **subscribers only**
- PostgreSQL is written to **only by the Storage Service**

---

## 5. Service Specifications

### 5.1 Data Ingestion Service (NestJS)

**Role:** Simulates IoT devices and publishes sensor data to the broker in real time.

#### Functional Requirements

- Simulate **N parallel IoT devices** (N is configurable at runtime)
- Generate and publish sensor messages based on the dataset schema (Section 2.3)
- Support **configurable publishing rate** (messages/second)
- Support **burst mode**: sudden rate spike from a base rate to a peak rate (Scenario C)
- Data values should be sampled/replayed from the actual dataset (`data/iot_telemetry_data.csv`, gitignored, loaded at startup) OR generated as realistic random values matching dataset ranges — selectable via `DATA_SOURCE` env var
- Embed measurement fields in every message: `seq` (per-device monotonic counter) and `sent_at_ms` (wall-clock send time) — see §2.3
- Publish to:
  - MQTT: configurable topic (e.g. `sensors/telemetry`)
  - Kafka: configurable topic (e.g. `sensor-telemetry`)

#### Required Configuration (env vars)

| Variable              | Description                                      | Example         |
|-----------------------|--------------------------------------------------|-----------------|
| `NUM_DEVICES`         | Number of parallel simulated devices             | `100`           |
| `MESSAGES_PER_SECOND` | Publishing rate per device or total              | `10`            |
| `BURST_TARGET_RATE`   | Peak rate for burst scenario                     | `5000`          |
| `BROKER_HOST`         | Broker hostname                                  | `mosquitto`     |
| `BROKER_PORT`         | Broker port                                      | `1883`          |
| `TOPIC`               | Target topic name                                | `sensors/data`  |
| `QOS_LEVEL`           | MQTT QoS (0, 1, or 2) — MQTT variant only       | `1`             |
| `KAFKA_ACKS`          | Kafka acks setting — Kafka variant only          | `1`             |
| `BROKER_TYPE`         | Selects the adapter at runtime (`mqtt` \| `kafka`) | `mqtt`        |
| `DATA_SOURCE`         | `replay` (from CSV) or `random` (generated)      | `replay`        |
| `DATASET_PATH`        | Path to the dataset CSV (replay mode)            | `/data/iot_telemetry_data.csv` |

---

### 5.2 Data Storage Service (NestJS)

**Role:** Subscribes to the broker and persists messages to PostgreSQL.

#### Functional Requirements

- Subscribe to broker topic
- Parse incoming JSON messages
- Write data to the `sensor_data` table (schema: Section 2.3)
- Implement **batch write strategy** for high-load scenarios

#### ⚠️ Critical: Batching Optimization

> During high-intensity stress tests (**Scenarios A and C**), the database I/O subsystem must not become the bottleneck — it would skew benchmark results away from the broker.
>
> **Implementation requirement:** Support two write modes, switchable via env var:
>
> | Mode         | Behavior                                           |
> |--------------|----------------------------------------------------|
> | `DIRECT`     | Write each message individually (default/dev mode) |
> | `BATCH`      | Buffer messages and flush on **size OR time** (whichever first) |
>
> Switch to `BATCH` mode for **Scenarios A and C**.
>
> **Flush trigger (both conditions):** flush when the buffer reaches `BATCH_SIZE` **OR** when `FLUSH_INTERVAL_MS` has elapsed since the last flush. Time-based flush is mandatory — without it, low-rate streams (e.g. Scenario D, idle periods) would stall un-flushed, and the count of buffered-but-unwritten rows on crash would be unbounded. Use a single multi-row `INSERT` per flush.

#### Required Configuration (env vars)

| Variable         | Description                              | Example                               |
|------------------|------------------------------------------|---------------------------------------|
| `DATABASE_URL`   | PostgreSQL connection string             | `postgresql://user:pass@db:5432/iotdb`|
| `BROKER_HOST`    | Broker hostname                          | `mosquitto`                           |
| `TOPIC`          | Source topic                             | `sensors/data`                        |
| `BROKER_TYPE`    | Selects the adapter (`mqtt` \| `kafka`)  | `mqtt`                                |
| `WRITE_MODE`     | `DIRECT` or `BATCH`                      | `BATCH`                               |
| `BATCH_SIZE`     | Messages per batch (when BATCH mode)     | `500`                                 |
| `FLUSH_INTERVAL_MS` | Max time before a partial batch flushes | `1000`                             |

---

### 5.3 Analytics Service (FastAPI)

**Role:** Subscribes to the message stream and performs real-time stream processing using a Tumbling Window.

#### Functional Requirements

##### Tumbling Window Specification

| Parameter        | Value                                             |
|------------------|---------------------------------------------------|
| Window type      | **Tumbling Window** (fixed, non-overlapping)      |
| Window duration  | **10 seconds**                                    |
| Primary metric   | Average temperature per window                    |
| Secondary metrics| Average humidity, average CO (for reporting)      |
| Alert threshold  | Configurable (default: `temp > 50°F`)             |

##### Processing Logic (mandatory)

```
For each 10-second tumbling window:
  1. Collect all messages received within the window
  2. Calculate: avg_temp, avg_humidity, avg_co
  3. IF avg_temp > ALERT_THRESHOLD:
       → Log CRITICAL ALERT with window metadata
     ELSE:
       → Log normal window summary
  4. Reset window accumulator for next cycle
```

##### Alert Log Format

```
[ALERT] {iso_timestamp} | Window [{start}–{end}] | AvgTemp: {value}°F | AvgHumidity: {value}% | AvgCO: {value}ppm | THRESHOLD EXCEEDED
[INFO]  {iso_timestamp} | Window [{start}–{end}] | AvgTemp: {value}°F | AvgHumidity: {value}% | AvgCO: {value}ppm | OK
```

##### End-to-End Latency Measurement (Scenario D)

The Ingestion Service embeds the **send timestamp** in each message (`sent_at_ms`, §2.3). The Analytics Service captures **two** timestamps to report **two complementary latencies**:

| Metric | Definition | What it measures |
|--------|------------|------------------|
| **Transport latency** | `receive_at_ms − sent_at_ms`, per message | Pure broker delivery time (publish → consume) |
| **Event-to-alert latency** | `alert_log_ms − sent_at_ms`, per alert | End-to-end including up to `WINDOW_SIZE_SEC` of tumbling-window buffering |

> The spec's original definition (`t_end` = alert log time) is the **event-to-alert** latency and inherently includes window buffering (a message arriving at the start of a 10s window waits ~10s before its window closes). Reporting transport latency alongside it isolates the broker's contribution from the windowing delay — both are useful for the MQTT vs Kafka comparison.

#### Required Configuration (env vars)

| Variable           | Description                                     | Example       |
|--------------------|-------------------------------------------------|---------------|
| `BROKER_TYPE`      | Selects the adapter (`mqtt` \| `kafka`)         | `mqtt`        |
| `WINDOW_SIZE_SEC`  | Tumbling window duration in seconds             | `10`          |
| `ALERT_THRESHOLD`  | Temperature threshold for alert                 | `50.0`        |
| `BROKER_HOST`      | Broker hostname                                 | `mosquitto`   |
| `TOPIC`            | Source topic                                    | `sensors/data`|

---

## 6. Message Broker Implementations

### 6.1 MQTT — Eclipse Mosquitto

#### QoS Levels — All Three Must Be Tested

| QoS | Guarantee          | Description                                           | Expected Impact              |
|-----|--------------------|-------------------------------------------------------|------------------------------|
| `0` | At most once       | Fire-and-forget; no ACK                               | Lowest latency, possible loss|
| `1` | At least once      | ACK required; duplicates possible                     | Moderate latency             |
| `2` | Exactly once       | 4-way handshake; no loss, no duplicates               | Highest latency              |

#### What to Analyze

- Effect of QoS level on **message latency** (p50, p95, p99)
- Effect of QoS level on **message loss rate**
- **Recovery after network disconnect:**
  - Persistent sessions (`cleanSession = false`) — broker retains subscriptions and queued messages for offline clients
  - Behavior at reconnect: are buffered messages delivered?

---

### 6.2 Apache Kafka (KRaft Mode)

#### Producer Acknowledgment — All Three Must Be Tested

| `acks` | Behavior                                                   | Trade-off                              |
|--------|-------------------------------------------------------------|----------------------------------------|
| `0`    | No ACK — fire and forget                                   | Maximum throughput, no guarantee       |
| `1`    | ACK from partition leader only                             | Balanced performance/reliability       |
| `all`  | ACK from all in-sync replicas                              | Maximum reliability, higher latency    |

#### What to Analyze

- **Consumer Lag:** difference between the latest offset produced and the latest offset committed by the consumer
  - Monitor lag during burst scenarios
  - Measure time for lag to return to 0 (recovery time)
- **Partitioning:** how partition count affects throughput and consumer parallelism
- **Recovery after network disconnect:**
  - Kafka's offset tracking guarantees the consumer resumes from the exact last committed offset
  - Measure: messages lost vs. messages replayed after reconnect

---

## 7. Experimental Scenarios

### Scenario A — Massive Sensor Ingestion

**Goal:** Determine maximum throughput and message loss rate under heavy parallel load.

| Parameter     | Values                  |
|---------------|-------------------------|
| Device count  | **100, 1000, 10000**    |
| Load type     | All devices publishing simultaneously |
| Storage mode  | **BATCH** (mandatory)   |

**Metrics to collect:**

| Metric                      | Description                                         |
|-----------------------------|-----------------------------------------------------|
| Max throughput (msg/s)      | Peak messages per second sustained by the broker    |
| Message loss rate (%)       | `lost / sent × 100`                                 |
| CPU per container (%)       | Average and peak during test                        |
| RAM per container (MB)      | Average and peak during test                        |

---

### Scenario B — Edge Connectivity Failure

**Goal:** Test broker recovery mechanisms after a simulated network partition.

#### Procedure

```bash
# Step 1: Verify normal system operation (messages flowing, storage writing)

# Step 2: Disconnect the ingestion service from the network
docker network disconnect <network_name> <ingestion_service_container>

# Step 3: Wait 30 seconds (simulated outage)
sleep 30

# Step 4: Reconnect
docker network connect <network_name> <ingestion_service_container>

# Step 5: Monitor recovery
```

**Metrics to collect:**

| Metric                | Description                                                   |
|-----------------------|---------------------------------------------------------------|
| Messages lost         | Number of messages not delivered during 30s outage           |
| Recovery time (s)     | Time from reconnect to stable message flow                   |
| Duplicate messages    | Any duplicates upon reconnection (especially QoS 1 / acks=1) |

**Per-broker analysis:**

| Broker | Mechanism                                                              |
|--------|------------------------------------------------------------------------|
| MQTT   | Persistent sessions: does the broker queue messages for offline client? |
| Kafka  | Offset tracking: does the consumer resume from the correct position?    |

---

### Scenario C — Burst Event Load

**Goal:** Test broker and service behavior under sudden traffic spikes.

| Parameter     | Value                               |
|---------------|-------------------------------------|
| Baseline rate | **50 msg/s**                        |
| Peak rate     | **5000 msg/s**                      |
| Burst duration| Several seconds (document exact duration used) |
| Load type     | Abrupt spike, not gradual ramp      |
| Storage mode  | **BATCH** (mandatory)               |

**Metrics to collect:**

| Metric              | Description                                             |
|---------------------|---------------------------------------------------------|
| Backlog size        | Queue depth at peak                                     |
| Backpressure        | How the broker responds when overloaded                 |
| Recovery time (s)   | Time for throughput to return to baseline after burst   |
| Message loss rate   | During and immediately after the burst                  |

---

### Scenario D — Real-Time Alerting Latency

**Goal:** Measure end-to-end latency from critical event generation to alert output.

#### Latency Definition

```
t_start : Ingestion Service embeds generation timestamp in message payload
t_end   : Analytics Service logs the ALERT to stdout

Latency = t_end - t_start  (milliseconds)
```

**Metrics to collect:**

| Metric           | Description                                              |
|------------------|----------------------------------------------------------|
| Min latency (ms) | Fastest observed alert delivery                         |
| Max latency (ms) | Slowest observed                                        |
| Avg latency (ms) | Arithmetic mean                                         |
| p95 latency (ms) | 95th percentile                                         |
| QoS/acks impact  | How delivery guarantee level affects alert latency      |

---

## 8. Performance Measurement

### 8.1 MQTT Load Testing Tools

Use **one** of the following (mandatory — do not write custom load generators):

| Tool           | Notes                                            |
|----------------|--------------------------------------------------|
| **emqtt-bench**| Official MQTT benchmark tool from EMQ            |
| **k6 + MQTT extension** | k6 with MQTT plugin                    |

### 8.2 Kafka Load Testing Tools

Use **one** of the following (mandatory):

| Tool                           | Notes                                              |
|--------------------------------|----------------------------------------------------|
| **kafka-producer-perf-test.sh**| Bundled with Kafka, high-performance native script |
| **k6 + xk6-kafka**            | k6 with Kafka extension                            |

### 8.3 Resource Monitoring

**Mandatory baseline tool:**
```bash
docker stats --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
```

**Optional (recommended for visual reporting):**
- Prometheus + Grafana stack integrated into Docker Compose

### 8.4 Performance Comparison Table — Must Be Filled

> This table must appear in the technical report based on actual experimental data.

| Broker | Config  | Devices | Throughput (msg/s) | p95 Latency (ms) | CPU (%) | RAM (MB) | Loss (%) |
|--------|---------|---------|-------------------|------------------|---------|----------|----------|
| MQTT   | QoS 0   | 100     |                   |                  |         |          |          |
| MQTT   | QoS 0   | 1000    |                   |                  |         |          |          |
| MQTT   | QoS 0   | 10000   |                   |                  |         |          |          |
| MQTT   | QoS 1   | 100     |                   |                  |         |          |          |
| MQTT   | QoS 1   | 1000    |                   |                  |         |          |          |
| MQTT   | QoS 1   | 10000   |                   |                  |         |          |          |
| MQTT   | QoS 2   | 100     |                   |                  |         |          |          |
| MQTT   | QoS 2   | 1000    |                   |                  |         |          |          |
| MQTT   | QoS 2   | 10000   |                   |                  |         |          |          |
| Kafka  | acks=0  | 100     |                   |                  |         |          |          |
| Kafka  | acks=0  | 1000    |                   |                  |         |          |          |
| Kafka  | acks=0  | 10000   |                   |                  |         |          |          |
| Kafka  | acks=1  | 100     |                   |                  |         |          |          |
| Kafka  | acks=1  | 1000    |                   |                  |         |          |          |
| Kafka  | acks=1  | 10000   |                   |                  |         |          |          |
| Kafka  | acks=all| 100     |                   |                  |         |          |          |
| Kafka  | acks=all| 1000    |                   |                  |         |          |          |
| Kafka  | acks=all| 10000   |                   |                  |         |          |          |

---

## 9. Reliability Analysis

### Critical Engineering Questions — Must Be Answered in the Report

#### Question 1
> **Why is MQTT ideal for deployment directly on edge devices (sensors), yet becomes inadequate when historical big-data analytics are required?**

Answer must address:
- Mosquitto's memory and CPU footprint vs. Kafka's JVM overhead
- MQTT's lack of a persistent message log (no replay)
- Pub/sub model without consumer offset tracking
- Protocol efficiency (small packets, MQTT over TCP/TLS for constrained networks)

#### Question 2
> **Why does Kafka dominate in data-intensive cloud systems? What is the "price" of its scalability in resource terms, and is it realistic to run Kafka on resource-constrained edge servers?**

Answer must address:
- Kafka's immutable append-only log as the key architectural differentiator
- Message replay and historical analytics
- Partitioning and horizontal scalability
- JVM RAM requirements and disk I/O patterns
- KRaft mode improvement vs. traditional ZooKeeper deployment for edge viability

---

## 10. Deliverables

| # | Deliverable                         | Description                                                                     |
|---|-------------------------------------|---------------------------------------------------------------------------------|
| 1 | **Git Repository**                  | Complete source code with commit history                                        |
| 2 | **Docker Compose configuration**    | Working `docker-compose.yml` files (one per broker variant, or unified with profiles) |
| 3 | **Broker configuration files**      | `mosquitto.conf`, Kafka server properties                                       |
| 4 | **Benchmark scripts**               | Shell/Python scripts to run all 4 scenarios on both brokers                    |
| 5 | **Experimental results**            | Raw measurement data (CSV, JSON, or captured logs)                             |
| 6 | **Technical report**                | System description, filled performance table, answers to critical questions     |

---

## 11. Repository Structure

> **Unified layout (adapter pattern, not duplicated per broker).** Earlier drafts had separate `mqtt/` and `kafka/` trees with a full copy of every service — that is exactly the code duplication this project avoids. Instead there is **one codebase per service**; each defines a `BrokerAdapter` interface implemented by `MqttAdapter` and `KafkaAdapter`, selected at runtime via `BROKER_TYPE`. Docker Compose **profiles** choose which broker stack is up. Switching brokers is one CLI flag — no code change, no duplicated services. See [DECISIONS.md](DECISIONS.md) §1–2.

```
/
├── docs/
│   ├── REQUIREMENTS.md            ← this file (what)
│   ├── DECISIONS.md               ← tech/architecture decisions (why)
│   ├── PLAN.md                    ← implementation plan (overview/index)
│   ├── plan/                      ← one file per iteration (00–08)
│   └── report.md                  ← technical report (deliverable #6)
│
├── data/                          ← GITIGNORED: dataset CSV (replay source / DB seed)
│   └── iot_telemetry_data.csv
│
├── shared/
│   ├── dataset_info.md            ← dataset schema (source of truth)
│   └── message-contract.md        ← canonical payload + topic names
│
├── services/                      ← npm workspaces root (NestJS services share libs)
│   ├── package.json
│   ├── libs/
│   │   ├── broker/                ← BrokerAdapter, MqttAdapter, KafkaAdapter, DI factory
│   │   └── contracts/             ← payload DTO, topic constants, env keys
│   ├── ingestion-service/         ← NestJS (publisher + device simulator)
│   │   ├── src/  Dockerfile  package.json
│   ├── storage-service/           ← NestJS (subscriber + TimescaleDB writer)
│   │   ├── src/  Dockerfile  package.json
│   └── analytics-service/         ← FastAPI (Python; own asyncio adapter)
│       ├── main.py  Dockerfile  requirements.txt
│
├── docker/
│   ├── docker-compose.yml         ← profiles: mqtt | kafka (+ always-on: db)
│   ├── .env.example
│   ├── mosquitto/mosquitto.conf
│   ├── kafka/                     ← KRaft config / env
│   └── db/init.sql                ← TimescaleDB extension + hypertable + PK
│
├── benchmarks/
│   ├── scenario-a-massive-ingestion.sh
│   ├── scenario-b-connectivity-failure.sh
│   ├── scenario-c-burst-load.sh
│   ├── scenario-d-alerting-latency.sh
│   ├── collect-docker-stats.sh
│   └── lib/                       ← log→CSV parsers (loss, latency percentiles)
│
├── results/
│   ├── mqtt/{scenario-a,scenario-b,scenario-c,scenario-d}/
│   └── kafka/{scenario-a,scenario-b,scenario-c,scenario-d}/
│
├── dashboard/                     ← OPTIONAL, last: NestJS api-gateway + React/Vite SPA
│
├── CLAUDE.md                      ← project reference + per-iteration change log
└── README.md                      ← run instructions
```

---

## 12. Implementation Checklist

### Infrastructure
- [ ] PostgreSQL container + `init.sql` with `sensor_data` schema
- [ ] MQTT stack: Mosquitto configured, Docker Compose working
- [ ] Kafka stack: KRaft mode configured, Docker Compose working
- [ ] `.env` files / env var strategy defined for both stacks

### Services — MQTT Variant
- [ ] Data Ingestion Service (NestJS) — MQTT publisher
- [ ] Data Storage Service (NestJS) — MQTT subscriber + PostgreSQL writer (batch support)
- [ ] Analytics Service (FastAPI) — MQTT subscriber + Tumbling Window + Alert logging

### Services — Kafka Variant
- [ ] Data Ingestion Service (NestJS) — Kafka producer
- [ ] Data Storage Service (NestJS) — Kafka consumer + PostgreSQL writer (batch support)
- [ ] Analytics Service (FastAPI) — Kafka consumer + Tumbling Window + Alert logging

### Broker Configuration Tests
- [ ] MQTT QoS 0
- [ ] MQTT QoS 1
- [ ] MQTT QoS 2
- [ ] Kafka `acks=0`
- [ ] Kafka `acks=1`
- [ ] Kafka `acks=all`

### Experimental Scenarios
- [ ] Scenario A — MQTT: 100 devices
- [ ] Scenario A — MQTT: 1000 devices
- [ ] Scenario A — MQTT: 10000 devices
- [ ] Scenario A — Kafka: 100 devices
- [ ] Scenario A — Kafka: 1000 devices
- [ ] Scenario A — Kafka: 10000 devices
- [ ] Scenario B — MQTT: network disconnect + reconnect + recovery analysis
- [ ] Scenario B — Kafka: network disconnect + reconnect + recovery analysis
- [ ] Scenario C — MQTT: burst 50 → 5000 msg/s
- [ ] Scenario C — Kafka: burst 50 → 5000 msg/s
- [ ] Scenario D — MQTT: end-to-end alert latency measured (min/avg/p95/max)
- [ ] Scenario D — Kafka: end-to-end alert latency measured (min/avg/p95/max)

### Benchmark Tools
- [ ] emqtt-bench or k6+MQTT: installed, smoke-tested
- [ ] kafka-producer-perf-test.sh or k6+xk6-kafka: installed, smoke-tested
- [ ] `docker stats` output captured and archived for all scenario runs

### Report & Deliverables
- [ ] Performance comparison table fully filled
- [ ] Question 1 answered (MQTT edge vs. analytics)
- [ ] Question 2 answered (Kafka cloud cost, edge viability)
- [ ] All raw results archived in `results/`
- [ ] Git repository with meaningful commit history

---

*Last updated: June 2026 — revised for unified adapter-pattern architecture, TimescaleDB hypertable, `seq`/`sent_at_ms` measurement fields, size-OR-time batch flush, and dual latency metric. See [DECISIONS.md](DECISIONS.md) §7.*
*Source: IoTS Project 2 specification + Environmental Sensor Telemetry dataset*