# Technical Report — MQTT vs Kafka for Event-Driven IoT Microservices

**IoTS Project 2** · Comparative evaluation of **MQTT (Eclipse Mosquitto)** and
**Apache Kafka (KRaft)** as the message backbone of a containerized, event-driven IoT
pipeline, across four experimental scenarios (massive ingestion, connectivity failure,
burst load, alerting latency).

> Reproducibility: every number in the tables below traces to a CSV under `results/`,
> produced by the scripts in [`benchmarks/`](../benchmarks/). Environment: WSL2 + Docker
> Desktop, single-node. See [README](../README.md), [DECISIONS](DECISIONS.md),
> [REQUIREMENTS](REQUIREMENTS.md), and the narrative [notes/](notes/).

---

## 1. System description

Three microservices communicate **only** through the broker:

```
ingestion (NestJS)  ──publish──▶  broker (Mosquitto | Kafka)  ──┬──▶  storage (NestJS) ──▶ TimescaleDB
                                                                └──▶  analytics (FastAPI) ──▶ alerts
```

- **Ingestion** — the only publisher; a device simulator that replays a real sensor
  dataset (or generates within per-profile ranges), stamping each message with a
  per-device `seq` and a `sent_at_ms` send time. Supports burst mode.
- **Storage** — the only DB writer; subscribes, tracks per-device `seq` integrity and
  transport latency, and writes to a TimescaleDB hypertable in `DIRECT` or `BATCH`
  (size-OR-time flush) mode with idempotent `ON CONFLICT` inserts.
- **Analytics** — a FastAPI service running a 10 s tumbling window over the stream,
  emitting `[ALERT]`/`[INFO]` summaries and capturing dual latency.

**The architectural keystone — one broker abstraction, zero duplication.** Each service
depends only on a `BrokerAdapter` interface (`publish` / `subscribe`); `MqttAdapter`
(mqtt.js / aiomqtt) and `KafkaAdapter` (kafkajs / aiokafka) implement it, and a factory
keyed on `BROKER_TYPE` is the *only* code that knows both brokers exist. Switching brokers
is **one env var + one Docker Compose profile** — no code change. The two NestJS services
share the adapter via npm workspaces; the Python service re-implements the same written
contract (`shared/message-contract.md`) — parity across languages, not duplication.
(See [notes/01-broker-abstraction.md](notes/01-broker-abstraction.md).)

**Infrastructure.** Docker Compose with profiles: `timescaledb` always on; `mqtt` →
Mosquitto; `kafka` → Kafka in **KRaft** mode (no ZooKeeper); `app` → the three services;
`tools` → Kafka UI (dev). TimescaleDB stores a hypertable on `ts`, PK `(ts, device)`.

---

## 2. Methodology

| Scenario | Driver | Why | Key metrics |
|----------|--------|-----|-------------|
| A — massive ingestion | **emqtt-bench** / **kafka-producer-perf-test** (mandated bench tools) | raw broker ceiling | throughput, loss, CPU, RAM |
| B — connectivity failure | the project simulator (disconnect publisher **and** subscriber) | needs addressable, ordered messages; the subscriber cut exercises the broker mechanism | messages lost, recovery, duplicates |
| C — burst load | the project simulator (`POST /burst`) | controlled 50→5000 spike | backlog, loss, recovery |
| D — alerting latency | the project simulator | needs `sent_at_ms` for real latency | transport + event-to-alert latency |

Resource usage is the mandatory `docker stats` baseline, sampled by
`collect-docker-stats.sh`. Loss in B/C is read straight from the storage service's
per-device `seq` tracker (a gap = lost, a repeat = duplicate). See
[notes/06-benchmark-harness.md](notes/06-benchmark-harness.md) for the harness design.

**Environment.** WSL2 (Linux 5.15) + Docker Desktop, single node; TimescaleDB
`2.17.2-pg16`, Mosquitto 2, Kafka `3.8.1` (KRaft). Single-node, single-partition unless
noted — absolute numbers are dev-box figures; the **MQTT-vs-Kafka comparison** is the
result of interest.

---

## 3. Performance comparison table (REQUIREMENTS §8.4)

Measured on this dev box. Device counts **100** and **1000** were run for every
QoS/acks config; **10000** was not run on the single WSL2 box (client/FD and memory
limits) — the commands to produce those rows are in [benchmarks/README.md](../benchmarks/README.md).
MQTT p95 latency is marked `NA` because emqtt-bench's pub mode reports throughput, not
per-message latency (per-message transport latency is measured instead in Scenario D);
Kafka p95 comes from kafka-producer-perf-test.

CPU is the broker container's `docker stats` average over the run (it can exceed 100% =
multi-core); RAM is the average resident memory. Throughput is the achieved peak rate.

| Broker | Config  | Devices | Throughput (msg/s) | p95 Latency (ms) | CPU (%) | RAM (MB) | Loss (%) |
|--------|---------|---------|--------------------|------------------|---------|----------|----------|
| MQTT   | QoS 0   | 100     | 10 642             | NA               | 2.0     | 4.5      | 0.00     |
| MQTT   | QoS 0   | 1000    | 69 840             | NA               | 21.0    | 4.7      | 0.00     |
| MQTT   | QoS 0   | 10000   | _not run (dev box)_ | —               | —       | —        | —        |
| MQTT   | QoS 1   | 100     | 5 335              | NA               | 3.9     | 4.5      | 0.00     |
| MQTT   | QoS 1   | 1000    | 33 019             | NA               | 31.5    | 4.3      | 0.00     |
| MQTT   | QoS 1   | 10000   | _not run (dev box)_ | —               | —       | —        | —        |
| MQTT   | QoS 2   | 100     | 5 321              | NA               | 11.7    | 4.2      | 0.07     |
| MQTT   | QoS 2   | 1000    | 21 463             | NA               | 45.1    | 5.4      | 0.53     |
| MQTT   | QoS 2   | 10000   | _not run (dev box)_ | —               | —       | —        | —        |
| Kafka  | acks=0  | 100     | 31 746             | 63               | 32.7    | 363.8    | 0.00     |
| Kafka  | acks=0  | 1000    | 130 378            | 296              | 63.1    | 396.4    | 0.00     |
| Kafka  | acks=0  | 10000   | _not run (dev box)_ | —               | —       | —        | —        |
| Kafka  | acks=1  | 100     | 33 445             | 56               | 46.5    | 395.0    | 0.00     |
| Kafka  | acks=1  | 1000    | 144 718            | 259              | 68.0    | 451.9    | 0.00     |
| Kafka  | acks=1  | 10000   | _not run (dev box)_ | —               | —       | —        | —        |
| Kafka  | acks=all| 100     | 26 738             | 127              | 31.0    | 443.3    | 0.00     |
| Kafka  | acks=all| 1000    | 135 685            | 271              | 33.9    | 446.1    | 0.00     |
| Kafka  | acks=all| 10000   | _not run (dev box)_ | —               | —       | —        | —        |

> The single most striking number is **RAM**: Mosquitto held steady at **~4–5 MB** under
> every load, while Kafka sat at **~360–580 MB** — roughly a **100× difference**. That one
> column underpins both critical-question answers in §5.

---

## 4. Scenario findings

### Scenario A — massive ingestion

Three clear effects in the data:

- **Throughput: Kafka >> MQTT at scale.** At 1000 producers Kafka sustained ~130–145 k
  msg/s vs MQTT's ~21–70 k msg/s. Kafka's batched, append-to-log producer path is built
  for exactly this firehose; MQTT's per-message QoS handshakes cost throughput.
- **Reliability knob costs throughput, on both brokers.** MQTT QoS 0 → 1 → 2 fell ~70 k →
  33 k → 21 k msg/s (1000 devices) as the handshake got heavier, and QoS 2 even showed a
  little loss here (0.07–0.53%) where the single subscriber couldn't keep up at peak.
  Kafka acks=all was slightly slower and higher-latency than acks=1/0 (waiting for the
  full ISR) — the durability tax. Kafka loss stayed 0 (durable log).
- **Resource cost: the 100× RAM gap.** Mosquitto used **~4–5 MB** throughout; Kafka used
  **~360–580 MB** and spiked multiple CPU cores (peaks 150–330%). This is the JVM +
  page-cache + log machinery — power for a price.

Takeaway: if you need maximum durable throughput and can pay the RAM, Kafka wins; if you
need a near-free broker on a tiny node and can tolerate at-most-once/at-least-once
semantics, MQTT wins.

### Scenario B — edge connectivity failure

We run this scenario in **two variants**, because where you cut the wire decides what you
actually measure. Loss/duplicates always come from the storage service's per-device `seq`
tracker (a gap = lost, a repeat = redelivered). The full grid is driven by
[`benchmarks/scenario-b-matrix.sh`](../benchmarks/scenario-b-matrix.sh).

#### Variant 1 — publisher disconnected (the original test)

The **ingestion** (publisher) container is network-disconnected for 30 s, then reconnected.

| Broker | Outage | Messages lost (seq gaps) | Duplicates | Recovery |
|--------|--------|--------------------------|------------|----------|
| MQTT   | 30 s   | 0                        | 0          | flush of buffered backlog |
| Kafka  | 30 s   | 0                        | 0          | flush of buffered backlog |

- **Both survive with zero loss — but for *client-side* reasons, not broker queuing.**
  mqtt.js buffers outbound messages while offline and flushes them on reconnect; kafkajs
  retries `send()` with backoff over a window that covers the outage. The publisher's own
  library masks the partition, so **this variant measures the client, not the broker**, and
  the two stacks look identical no matter what the brokers actually do underneath.

#### Variant 2 — subscriber disconnected (what the requirements actually ask for)

> **Why we disconnect the subscriber.** REQUIREMENTS §7-B asks us to show *messages lost,
> recovery and duplicates* — i.e. the broker's **offline-delivery mechanism**: MQTT's
> persistent-session queue vs Kafka's durable log + consumer offsets. Disconnecting the
> *publisher* (the literal reading of the task, and likely how it was first phrased) never
> exercises that mechanism, because the publisher library buffers and replays on its own —
> both brokers then trivially score 0/0 and the comparison says nothing. The mechanism only
> engages when the **consumer** is the one that goes away and has to *resume*: that is where
> MQTT either queued-for-you-or-didn't and Kafka rewinds to its last offset. So we keep the
> publisher variant for honesty, but the **subscriber** variant is the one that answers the
> question. (We also lowered the MQTT keepalive to 10 s for these runs so a 30 s outage
> actually exceeds it — otherwise Mosquitto still believes the client is connected and holds
> everything, hiding the clean-vs-persistent difference. See
> [notes/07-scenario-b-redesign.md](notes/07-scenario-b-redesign.md).)

The **storage** (subscriber) container is disconnected while ingestion keeps publishing
(~1000 msg/s). For MQTT we sweep the session knobs that decide its behaviour; Kafka has no
such knob — the log decides.

| Broker | Variant (config) | Outage | Messages lost | Dups | What it shows |
|--------|------------------|--------|---------------|------|---------------|
| MQTT  | persistent (`clean=false`, QoS 1, unbounded queue) | 30 s | **0**     | 0 | broker **queues** for the offline subscriber → no loss |
| MQTT  | clean session (`clean=true`, QoS 1)                | 30 s | **31 000**| 0 | session discarded on disconnect → everything during the outage is **dropped** |
| MQTT  | QoS 0 (`clean=false`, QoS 0)                       | 30 s | **31 000**| 0 | QoS 0 is never queued, even for a persistent session → **dropped** |
| MQTT  | persistent + **capped** queue (`max_queued=10000`) | 30 s | **5 884** | 0 | the broker's in-RAM queue **overflows** → partial loss |
| Kafka | consumer resume (defaults)                         | 30 s | **0**     | 1 | consumer **resumes from its last committed offset** → no loss |
| Kafka | consumer resume, **long** outage                   | 90 s | **0**     | 1 | durable log is **length-independent** → still no loss |

- **MQTT's reliability is entirely a function of its session config.** With a persistent
  session (stable client-id, `clean=false`, QoS ≥ 1) Mosquitto queues messages for the
  absent subscriber and delivers them on reconnect — **0 lost**. Flip any one of those and
  the guarantee evaporates: a **clean session** has nothing retained (31 000 lost ≈ 30 s ×
  1000 msg/s), **QoS 0** is fire-and-forget so it is never queued (31 000 lost), and even a
  persistent session loses once its **bounded in-memory queue overflows** (a 10 000-message
  cap dropped ~5.9 k). This is the price of MQTT keeping state in RAM.
- **Kafka loses nothing in every variant** — including a 3× longer outage — because the
  messages were appended to the **durable log** regardless of who was listening, and the
  returning consumer just resumes from its **committed offset**. The single **duplicate** is
  Kafka's honest **at-least-once** semantics: one message had been processed but its offset
  not yet committed when the consumer dropped, so it was redelivered (and our idempotent
  `ON CONFLICT` insert absorbs it harmlessly).
- **This is the structural reliability difference the scenario is meant to expose.** MQTT
  can match Kafka *only* under a specific, RAM-bounded configuration and only for outages
  short enough to fit the queue; Kafka is correct by construction, independent of config,
  outage length, or which end disconnected — at the resource cost quantified in §3.

### Scenario C — burst event load

Baseline 50 msg/s, abrupt spike to the 5000 msg/s burst target for 5 s, watching the
storage service's backlog (`buffered`) per second.

| Broker | Peak backlog (buffered rows) | Messages lost | Recovery time |
|--------|------------------------------|---------------|---------------|
| MQTT   | 45                           | 0             | ~0 s          |
| Kafka  | 353                          | 0             | ~1 s          |

- **Both absorbed the 100× spike with zero loss.** The storage `BATCH` writer (flush on
  size OR time) soaked up the burst; broker + DB kept up at these volumes on the dev box.
- **Kafka showed a larger transient backlog** (353 vs 45 buffered rows). Kafka hands the
  consumer fetched *batches*, so the storage buffer jumps in bigger steps between flushes;
  MQTT's per-message push drained more smoothly. Both recovered within ~1 s.
- Validates the **mandatory BATCH mode** (REQUIREMENTS §5.2): under the spike the DB writer
  never became the bottleneck and nothing was dropped.

### Scenario D — real-time alerting latency

Both brokers measured the same way (the analytics service, 5 devices @ 50 msg/s, 10 s
window, alert threshold 20 °F so windows fire). Two latencies per the methodology:

| Broker | Transport avg (ms) | Transport max (ms) | Event-to-alert avg (ms) | Event-to-alert p95 (ms) |
|--------|--------------------|--------------------|-------------------------|--------------------------|
| MQTT   | **1.24**           | 3                  | 5 369                   | 6 149                    |
| Kafka  | **6.65**           | 1 361              | 5 641                   | 6 836                    |

- **Transport (pure broker hop): MQTT is several× faster** — ~1.2 ms vs ~6.7 ms — and far
  more consistent (max 3 ms vs a 1.4 s Kafka outlier from consumer-group/fetch warm-up).
  MQTT's lightweight per-message push beats Kafka's fetch/batch consumer model for
  single-message reactivity.
- **Event-to-alert is dominated by the window, not the broker.** Both land around ~5.4–5.6 s
  because a 10 s tumbling window adds, on average, ~half a window of buffering. The broker's
  ~5 ms contribution is in the noise here — which is exactly *why* the report measures
  transport separately: the windowing delay would otherwise hide the broker difference.
- **Implication:** for *latency-critical* alerting, MQTT's lower transport latency helps,
  but the windowing strategy matters far more; shrink the window to cut event-to-alert.
  (QoS/acks sweep — set `QOS_LEVEL`/`KAFKA_ACKS` and re-run; the script labels each row.)

---

## 5. Reliability analysis — the critical engineering questions (REQUIREMENTS §9)

### Question 1 — Why is MQTT ideal *on the edge* (sensors), yet inadequate when historical big-data analytics are required?

**MQTT is built for the constrained edge.**

- **Tiny footprint.** Mosquitto is a small C broker: in our runs it idled and ran at a
  few **MB** of RAM and near-zero CPU while moving thousands of messages/s (see the
  Scenario A resource columns). There is no JVM, no page cache to feed, no background
  compaction. That fits a Raspberry-Pi-class gateway next to the sensors.
- **Protocol efficiency.** MQTT has a ~2-byte fixed header and a compact publish packet,
  designed for lossy, low-bandwidth, high-latency links (it runs happily over flaky
  cellular/TCP, and over TLS when needed). QoS 0/1/2 lets a device trade reliability for
  battery/bandwidth per message.
- **Simple pub/sub.** A sensor just connects and publishes; a subscriber just receives.
  No partition assignment, no offset bookkeeping, no consumer-group coordination.

**Why it falls short for big-data analytics.**

- **No persistent log / no replay.** MQTT is a *message router*, not a store. Once a
  message is delivered (or its QoS handshake completes), the broker forgets it. A
  subscriber that wasn't connected, or an analytics job that wants to recompute over last
  month's data, **cannot get the history back** — there is nothing to replay. Our storage
  service has to persist to TimescaleDB precisely because the broker keeps nothing.
- **No consumer offsets.** There is no notion of "where each consumer is." A subscriber
  that reconnects resumes from *now* (persistent sessions can queue *some* messages for a
  known client, bounded by broker memory — not a durable, rewindable log). You cannot add
  a second analytics consumer next week and have it read from the beginning.
- **Fan-out, not parallel consumption.** Multiple subscribers each get the full stream;
  MQTT has no built-in way to *partition* a high-volume topic across a pool of workers for
  horizontal throughput (shared subscriptions exist but are limited and broker-specific).
- **Backpressure / buffering is bounded by broker RAM.** Under sustained overload the
  small in-memory broker has nowhere to spill, so it drops — fine for "latest reading
  wins" telemetry, wrong for "lose nothing" analytics ingestion.

**In short:** MQTT optimizes for *getting a small message off a constrained device, now,
cheaply*. Analytics needs *durability, replay, offsets, and partitioned scale* — none of
which are MQTT's job. That is exactly why our pipeline uses MQTT as the edge transport but
a database (and, on the Kafka side, the log itself) for history.

### Question 2 — Why does Kafka dominate data-intensive cloud systems? What is the resource "price" of its scalability, and is Kafka realistic on resource-constrained edge servers?

**Kafka's superpower is the immutable, append-only commit log.**

- **The log is the architecture.** Kafka doesn't "deliver and forget" — it *appends* every
  message to a partitioned, on-disk log with a retention window. Consumers track their own
  **offset**, so any consumer can read at its own pace, **replay** from any point, or join
  later and read from the beginning. Our storage and analytics services are two independent
  **consumer groups** reading the *same* stream — the log makes that natural.
- **Historical analytics & reprocessing.** Because the log is durable and rewindable, a new
  analytics model can be back-tested over retained data without re-ingesting from devices.
  This is the capability MQTT structurally lacks.
- **Partitioning = horizontal scale + ordering.** A topic splits into partitions; producers
  key by entity (we key by `device`, preserving per-device `seq` order) and a consumer group
  spreads partitions across workers. Throughput scales by adding partitions and consumers.
  In Scenario A, kafka-producer-perf-test sustained a high record rate with acks-tunable
  durability.

**The price, in resources.**

- **JVM RAM and the page cache.** Kafka runs on the JVM and leans heavily on the OS page
  cache for its log; healthy Kafka wants hundreds of MB to GBs of RAM. In our runs the
  Kafka container's memory and CPU were **orders of magnitude higher than Mosquitto's**
  (tens-to-hundreds of MB and multi-core CPU spikes vs Mosquitto's few MB) — the resource
  columns in §3 quantify it.
- **Disk I/O.** Durability means every message hits the log (and is fsync'd per the acks
  policy); sustained ingest is disk-bound, and retention consumes storage continuously.
- **Operational weight.** Even single-node, Kafka is a heavier beast to run, tune, and
  keep healthy than a config-file broker like Mosquitto.

**Is Kafka realistic on the edge?**

- Historically *no* — classic Kafka also required a **ZooKeeper** ensemble, doubling the
  moving parts and RAM. **KRaft mode** (what we deploy) removes ZooKeeper: the controller
  quorum is built into Kafka itself, cutting the footprint and operational complexity. That
  makes a *single-node* Kafka meaningfully more viable on a beefier edge **server** (not a
  sensor, not a Pi) — e.g. a regional gateway with several GB of RAM and an SSD.
- But it is still the wrong tool *at the sensor*: the JVM/RAM/disk cost dwarfs what a
  microcontroller or Pi-class node can spare, and the edge rarely needs replayable history
  locally. The pragmatic topology is exactly this project's: **MQTT at the edge → bridge →
  Kafka in the cloud/regional tier** for durable, replayable, horizontally-scaled analytics.

**Verdict.** Kafka dominates the cloud because the append-only log gives durability,
replay, offsets, and partitioned scale — at a real RAM/CPU/disk cost. KRaft lowers the bar
enough for a capable edge *server*, but MQTT remains the right choice on the constrained
device itself.

---

## 6. Conclusions

The experiments make the trade-off concrete and consistent with the architecture:

- **Throughput & durability → Kafka.** It sustained ~2× the message rate at 1000
  producers and never lost a message (durable log), at the cost of much higher latency
  variance and resources.
- **Footprint & edge fitness → MQTT.** Mosquitto ran the whole time in **~4–5 MB** of RAM
  with the lowest, most consistent transport latency (~1 ms). Kafka needed **~100× the
  RAM** (~360–580 MB) plus multi-core CPU and disk — fine for a server, impossible for a
  sensor.
- **Reliability knobs cost performance predictably.** MQTT QoS↑ and Kafka acks=all both
  trade throughput/latency for stronger guarantees — choose per message criticality.
- **The pipeline absorbed bursts and a publisher dropout with zero loss** (BATCH writes +
  client buffering). And when we cut the **subscriber** — the test that actually probes the
  broker — the structural difference showed plainly: **Kafka lost nothing** in every config
  and at 3× the outage (durable log + offset resume), while **MQTT only matched it under a
  persistent, QoS ≥ 1, unbounded-queue session** and lost everything under clean-session,
  QoS 0, or a queue overflow (§4). Kafka's reliability is by construction; MQTT's is a
  RAM-bounded configuration choice.
- **The architecture delivered on its promise:** every result above was produced by
  flipping `BROKER_TYPE` + the Compose profile — **one flag, no code change** — which is
  what made a clean apples-to-apples comparison possible in the first place.

**Recommended topology:** MQTT at the constrained edge → bridge → Kafka in the
cloud/regional tier for durable, replayable, horizontally-scaled analytics. This project
implements exactly that split behind a single broker abstraction.

### Scope notes (honesty about the runs)
- Device counts **100** and **1000** were measured for the full QoS/acks grid; **10000**
  was not run on the single WSL2 box (FD/RAM limits) — harness commands are provided.
- Absolute numbers are dev-box figures (single node, single partition); the **relative
  MQTT-vs-Kafka comparison** is the robust result.
- Scenario B is run in two variants: disconnecting the *publisher* (client buffering masks
  the outage → 0/0 on both brokers) and disconnecting the *subscriber* (exercises the broker
  mechanism — MQTT loses under clean-session/QoS 0/queue-overflow, Kafka resumes from its
  offset with no loss). The subscriber variant is the one that answers REQUIREMENTS §7-B; it
  uses a lowered MQTT keepalive (10 s) so a 30 s outage actually tears the session down.

---

## 7. Reproducibility

```bash
cp docker/.env.example docker/.env                 # set BROKER_TYPE + BROKER_HOST/PORT
docker compose --profile <mqtt|kafka> up -d        # Scenario A (broker only)
docker compose --profile <mqtt|kafka> --profile app up -d   # Scenarios B/C/D (+ services)
BROKER=<mqtt|kafka> benchmarks/scenario-a-massive-ingestion.sh   # → results/<broker>/scenario-a/
BROKER=<mqtt|kafka> benchmarks/scenario-b-connectivity-failure.sh
BROKER=<mqtt|kafka> benchmarks/scenario-c-burst-load.sh
BROKER=<mqtt|kafka> benchmarks/scenario-d-alerting-latency.sh
```

Full tool details and tunables: [benchmarks/README.md](../benchmarks/README.md).
