# Iteration 1 — Infrastructure (DB + brokers + compose profiles)

**Goal:** Bring up the shared database and both broker stacks, switchable by a single Docker Compose profile flag.

## Tasks

- `docker/docker-compose.yml`:
  - **always-on** service `timescaledb` (image `timescale/timescaledb:latest-pg16`), volume for data, `db/init.sql` mounted to `/docker-entrypoint-initdb.d/`.
  - profile **`mqtt`** → `mosquitto` (`eclipse-mosquitto`), config volume, ports 1883 (+9001 WS).
  - profile **`kafka`** → `kafka` (`apache/kafka` or `confluentinc/cp-kafka`), KRaft mode, port 9092.
- `docker/db/init.sql`:
  - `CREATE EXTENSION IF NOT EXISTS timescaledb;`
  - `CREATE TABLE sensor_data (...)` with columns from REQUIREMENTS §2.3 incl. `seq BIGINT`, `sent_at_ms BIGINT`, PK `(ts, device)`.
  - `SELECT create_hypertable('sensor_data', 'ts');`
- `docker/mosquitto/mosquitto.conf`: listener 1883, optional 9001 WS, `persistence true`, `persistent_client_expiration` set for Scenario B persistent sessions.
- `docker/kafka/` env: `KAFKA_NODE_ID`, `KAFKA_PROCESS_ROLES=broker,controller`, `KAFKA_CONTROLLER_QUORUM_VOTERS`, listeners; single node; default 1 partition (3/6 variants later for Scenario A).
- `docker/.env.example`: `BROKER_TYPE`, `BROKER_HOST`, `BROKER_PORT`, `DATABASE_URL`, topic names, and per-service vars (collected from REQUIREMENTS §5).
- **Dev tooling** (profile **`tools`**, dev-only — see [DECISIONS §7.6](../DECISIONS.md#76-dev-mode-observability-tooling-kafka-ui--mqtt-explorer) + [notes/02-dev-tooling.md](../notes/02-dev-tooling.md)): `kafka-ui` (`ghcr.io/kafbat/kafka-ui`) on `iot-net`, pointed at `kafka:9092`, web UI on `${KAFKA_UI_PORT:-8080}`. MQTT uses the external **MQTT Explorer** desktop app (no container) against `localhost:1883`.

## Verification

- `docker compose --profile mqtt up -d` → `timescaledb` + `mosquitto` healthy.
- `docker compose --profile kafka up -d` → `timescaledb` + `kafka` healthy.
- Hypertable present: `SELECT * FROM timescaledb_information.hypertables;` returns `sensor_data`.
- Brokers reachable: `mosquitto_pub`/`mosquitto_sub` smoke test; `kafka-topics.sh --list` via `docker exec`.

## Commit

`feat(infra): timescaledb hypertable + mosquitto + kafka KRaft via compose profiles`
