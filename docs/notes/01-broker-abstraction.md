# 01 — The broker-neutral architecture

**The single most important design idea in this project.** Everything else hangs off it.

## The problem we were avoiding

The naive way to "compare MQTT vs Kafka" is to write the whole system twice — an
MQTT publisher + MQTT subscriber, and a parallel Kafka publisher + Kafka subscriber.
That is literal copy-paste of all the business logic (device simulator, batch DB
writer, alerting window) with two different client libraries wired in. It rots
immediately: a fix in one path doesn't reach the other, and any benchmark difference
could be blamed on the two code paths drifting apart, not on the brokers.

## What we did instead

Each service defines **one interface** and depends only on it:

- `PublisherAdapter` — `publish(topic, message)`
- `SubscriberAdapter` — `subscribe(topic, handler)`

(`services/libs/broker/src/broker-adapter.ts`)

Two implementations sit behind it: `MqttAdapter` (mqtt.js) and `KafkaAdapter`
(kafkajs). The business code **never** imports either one and never says
`if (broker === 'kafka')`. There is exactly **one** place in the entire codebase
that knows both brokers exist — the factory:

```ts
// broker.module.ts — the ONLY switch on broker type
function createBrokerAdapter(config) {
  switch (config.type) {
    case 'mqtt':  return new MqttAdapter(config);
    case 'kafka': return new KafkaAdapter(config);
  }
}
```

It's wired into NestJS DI as `BrokerModule.forRoot()`, exposing a `BROKER_ADAPTER`
token. Services inject the token; whichever adapter the factory built is what they get.

## How you switch brokers

Two coordinated knobs, **no code change, no rebuild**:

1. `BROKER_TYPE=mqtt|kafka` — selects the runtime adapter (the factory reads it).
2. `docker compose --profile mqtt|kafka up` — selects which broker container runs.

That's the whole "switch." It's the headline claim of the project and it's literally
one env var + one CLI flag.

## Two languages, one contract

The NestJS services (ingestion, storage) share the *same* adapter code via npm
workspaces (`@iots/broker`), so even the adapter exists once for them. The analytics
service is **FastAPI (Python)** — it re-implements the same two-method abstraction in
Python (asyncio-mqtt / aiokafka). That is *not* duplication we failed to remove: it's
a different language. Both sides obey the one written contract in
[`shared/message-contract.md`](../../shared/message-contract.md) (JSON payload, topic
names, the `seq` + `sent_at_ms` fields). The contract is the source of truth; the two
implementations are conformant mirrors.

## Where broker differences are *allowed* to live

The interface is deliberately broker-neutral, but the brokers aren't identical, so the
knobs that have no cross-broker meaning live **inside** each adapter, fed from env:

- MQTT: `QOS_LEVEL` (0/1/2), and `clean:false` for a **persistent session** (Scenario B).
- Kafka: `KAFKA_ACKS` (0/1/all), consumer **group id**, and we **key messages by
  `device`** so each device's stream lands on one partition → its `seq` stays ordered.

The caller never sees any of this — it just calls `publish` / `subscribe`.

## If asked

- *"How is switching brokers really one flag?"* → `BROKER_TYPE` picks the adapter via
  the DI factory; the compose profile picks the container. No recompile.
- *"Isn't the Python service duplication?"* → Different language, same written contract.
  The TS↔TS sharing (workspaces) removes the only true duplication.
- *"How do you trust the benchmark isn't measuring two different code paths?"* →
  Business logic is identical across brokers — only the ~80-line adapter differs.
- *"Why key Kafka messages by device?"* → Per-device partition affinity keeps `seq`
  monotonic within a partition, so loss/duplicate detection stays exact.
