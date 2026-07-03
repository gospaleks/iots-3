# 02 — Dev tooling: Kafka UI + MQTT Explorer

**Dev-mode only.** These tools let us *watch* the brokers while developing — they are
never part of a measured benchmark run (the Kafka UI lives behind its own compose
profile precisely so it can't steal resources during a measurement).

## Kafka — `kafbat/kafka-ui` (in Docker)

A web UI that shows topics, partitions, consumer groups, messages, offsets, and
**consumer lag** — exactly the things you want to eyeball when reasoning about Kafka
throughput and delivery in Scenarios A/B/C/D.

- **Image:** `ghcr.io/kafbat/kafka-ui:v1.0.0` (the actively-maintained fork of the
  archived `provectus/kafka-ui`).
- **Where:** a `kafka-ui` service in `docker/docker-compose.yml`, gated behind the
  **`tools`** profile, on the same `iot-net` network, pointed at `kafka:9092`.
- **Run it:**
  ```bash
  cd docker
  docker compose --profile kafka --profile tools up -d
  # open http://localhost:8080   (override with KAFKA_UI_PORT in .env)
  ```
- **Why a separate `tools` profile (not just the `kafka` profile)?** So normal and
  benchmark runs (`--profile kafka`) bring up *only* the broker. You opt into the UI
  explicitly. Keeps measured runs clean.

**Verified:** UI comes up on `:8080`, connects to the cluster (`status: online`,
`brokerCount: 1`); created topics/partitions show up in the UI.

## MQTT — MQTT Explorer (external desktop app)

MQTT has no UI container here **by design** — the nicest MQTT inspector is the
**MQTT Explorer** desktop app (free, by Thomas Nordquist). It gives a live topic tree,
shows publishes/subscribes, lets you decode JSON payloads, publish test messages, and
watch data flow — ideal for debugging the ingestion → storage/analytics path.

- **Install:** Windows desktop app (we develop on WSL2 + Docker Desktop, so install the
  Windows build and connect across the localhost boundary). Download from
  <http://mqtt-explorer.com/> (or the Microsoft Store / `winget install` build).
- **Connect (after `docker compose --profile mqtt up -d`):**
  | Field | Value |
  |-------|-------|
  | Protocol | `mqtt://` |
  | Host | `localhost` |
  | Port | `1883` |
  | Auth | none (anonymous; broker is open in dev) |
- **Topic to watch:** `sensors/telemetry` (subscribe to `#` to see everything).
- **WebSocket option:** Mosquitto also exposes WS on `9001` if you ever want a
  browser-based MQTT client instead.

> Status: **approved for install.** It's a well-known, safe inspector and read-only by
> default — you only publish when you explicitly hit "publish."

## If asked

- *"Why a container for Kafka but a desktop app for MQTT?"* → Kafka has no good
  lightweight desktop inspector; the web UI is the norm. MQTT's best tool (MQTT
  Explorer) is a desktop app, and it connects fine over localhost — no need to
  containerize it.
- *"Do these affect benchmark numbers?"* → No. Kafka UI is opt-in via the `tools`
  profile and left off during measurement; MQTT Explorer runs on the host, not in the
  measured stack.
