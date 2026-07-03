# 07 — Scenario B redesign (publisher vs subscriber outage)

The first cut of Scenario B disconnected the **publisher** (`iots-ingestion`) for 30 s.
Both brokers scored **0 lost / 0 duplicates** and looked identical — which is exactly the
problem: the result was real but said nothing about the brokers. This note explains why,
and what we changed so the scenario answers the question REQUIREMENTS §7-B actually asks.

## Why the publisher test is a trap

Disconnect the publisher and the publisher's **own client library** covers for it:

- **mqtt.js** buffers outbound messages while offline and flushes them on reconnect.
- **kafkajs** retries `send()` with backoff over a window that spans the outage.

So nothing ever reaches the broker during the outage, the broker's offline-delivery
mechanism is never invoked, and both stacks trivially report zero loss. You are measuring
the *client*, not the broker. Any MQTT-vs-Kafka difference is invisible.

## The fix: disconnect the *subscriber*

The mechanism the task wants to compare — **MQTT persistent-session queue** vs **Kafka
durable log + consumer offsets** — only engages when the **consumer** disappears and has
to *resume*. So Variant 2 disconnects `iots-storage` while ingestion keeps publishing, and
reads loss/dups from the storage `seq` tracker as before. `DISCONNECT_TARGET=storage` (the
new default) vs `ingestion` selects which end drops.

## The keepalive gotcha (why 30 s wasn't enough at first)

Even disconnecting the subscriber, the first runs *still* showed 0 loss for every MQTT
config. Two layers were hiding the partition:

1. **TCP didn't die.** `docker network disconnect` + reconnect within ~30 s doesn't reset
   the TCP connection — packets stall and resume, so the broker's buffered messages just
   flow through when the link returns (you can see it as a ~28 s "recovery" = backlog flush).
2. **MQTT keepalive.** Mosquitto only declares a client dead after ~1.5× the keepalive.
   mqtt.js defaults to **60 s**, so during a 30 s outage the broker still thinks the
   subscriber is *connected* and holds messages for it — clean-session or not.

Fix: a configurable, low keepalive (`MQTT_KEEPALIVE_SEC`, default 60, **set to 10** for the
subscriber variants). Now the broker detects the dead client inside the 30 s window, the
mqtt.js client genuinely tears down and reconnects, and clean-vs-persistent semantics
finally diverge. (One adapter line: `keepalive: config.keepaliveSec`.)

## What the variants prove (measured, ~1000 msg/s)

| Variant | MQTT | Kafka |
|---------|------|-------|
| persistent (`clean=false`, QoS 1, unbounded) | **0 lost** (broker queued) | — |
| clean session (`clean=true`, QoS 1) | **31 000 lost** (nothing retained) | — |
| QoS 0 (`clean=false`, QoS 0) | **31 000 lost** (QoS 0 never queued) | — |
| persistent + `max_queued=10000` | **5 884 lost** (RAM queue overflowed) | — |
| consumer resume, 30 s | — | **0 lost**, 1 dup |
| consumer resume, **90 s** | — | **0 lost**, 1 dup |

- **MQTT reliability = a RAM-bounded config choice.** It matches Kafka *only* with a
  persistent, QoS ≥ 1, unbounded-queue session, and only while the queue fits in memory.
- **Kafka is correct by construction.** The log holds every message regardless of who is
  listening or for how long; the consumer rewinds to its committed offset. The lone
  duplicate is honest **at-least-once** (processed-but-not-yet-committed on disconnect),
  absorbed by our idempotent `ON CONFLICT` insert.

## How it's wired

- `benchmarks/scenario-b-connectivity-failure.sh` — generalized: `DISCONNECT_TARGET`,
  records `qos/clean_session/max_queued/keepalive_s` columns, waits for `/health` after
  reconnect and tolerates transient empty `/stats` reads (a 90 s-outage race we hit).
- `benchmarks/scenario-b-matrix.sh` — orchestrates the whole grid for one broker: recreates
  ingestion+storage (and, for MQTT, the broker with a fresh session store) per variant so
  variants can't contaminate each other, points `.env`/`mosquitto.conf` at the right
  broker/queue-cap, and restores both on exit.
- New env: `MQTT_KEEPALIVE_SEC`; compose interpolates `QOS_LEVEL` / `MQTT_CLEAN_SESSION` /
  `MQTT_KEEPALIVE_SEC` for ingestion+storage so a run can override them at `up` time.

## If asked

- *Why did both brokers show 0 loss at first?* The publisher's client library buffered the
  outage; the broker was never tested. Cutting the subscriber (and lowering keepalive so the
  broker notices) reveals the real difference.
- *Is disconnecting the subscriber "cheating" vs the task wording?* No — it's the only cut
  that exercises the broker mechanism the task is comparing. We keep the publisher variant
  too, labelled, for completeness.
- *Why does Kafka show a duplicate but MQTT doesn't?* At-least-once offset commit timing —
  Kafka favours "deliver again" over "lose it." Our insert is idempotent, so it's harmless.
- *Could MQTT be made lossless here?* Yes — persistent session + QoS ≥ 1 + a big enough
  queue. But that trades the broker's RAM for durability and still can't survive an outage
  bigger than the queue; Kafka's on-disk log has no such ceiling.
