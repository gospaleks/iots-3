# Iteration 2 — Shared NestJS libs (adapter + contracts)

**Goal:** The reuse backbone — the `BrokerAdapter` abstraction both NestJS services consume, so broker code exists exactly once.

## Tasks

- `services/package.json`: npm workspaces root (`"workspaces": ["libs/*", "ingestion-service", "storage-service"]`).
- `services/libs/contracts`:
  - Payload DTO (`SensorMessage`): dataset fields + `seq` + `sent_at_ms` (matches `shared/message-contract.md`).
  - Topic constants (`sensors/telemetry`, `sensor-telemetry`), env-key constants.
- `services/libs/broker`:
  - `BrokerAdapter` interface — publisher side (`publish(topic, payload)`) and subscriber side (`subscribe(topic, handler)`); split into `PublisherAdapter` / `SubscriberAdapter` if cleaner.
  - `MqttAdapter` (mqtt.js): connect, publish with `QOS_LEVEL`, subscribe; persistent session (`clean: false`) for Scenario B.
  - `KafkaAdapter` (kafkajs): producer with `acks` from env; consumer with group id; storage = group A, analytics path uses FastAPI separately.
  - Nest DI **factory** keyed on `BROKER_TYPE` (`useFactory` in a `BrokerModule`).

## Design notes

- Business code depends only on `BrokerAdapter` — no `if (broker === ...)` anywhere outside the factory.
- QoS/acks are adapter-internal, injected from env; the interface stays broker-neutral.

## Verification

- Unit test: factory returns `MqttAdapter` for `BROKER_TYPE=mqtt`, `KafkaAdapter` for `kafka`.
- Integration smoke: each adapter connects + round-trips a message against the Iteration 1 brokers.

## Commit

`feat(libs): BrokerAdapter (mqtt.js/kafkajs) + shared contracts via npm workspaces`
