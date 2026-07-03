# 05 — Analytics service (FastAPI tumbling window)

The real-time stream processor, and the **Python** member of the system. It subscribes to
the same broker stream, runs a tumbling window, raises alerts, and captures the
end-to-end latencies. It is *subscribe-only* — it never writes to the DB.

## Why this one is in Python (and why that's not "duplication")

The other two services are NestJS and share `@iots/broker`. Analytics re-implements the
**same** `SubscriberAdapter` abstraction in Python (aiomqtt / aiokafka), keyed on
`BROKER_TYPE` by the same kind of factory. Different language ⇒ the code can't be shared,
so this is *necessary parity*, not the duplication we set out to avoid. Both sides obey
the one written contract in [`shared/message-contract.md`](../../shared/message-contract.md)
— same JSON payload, same topics, same `seq` + `sent_at_ms` fields. (`asyncio-mqtt` is now
published as **`aiomqtt`** — same library, renamed.)

## Fan-out: two independent consumers

Storage and analytics both consume the *full* stream:

- **MQTT** — both just subscribe to the topic; the broker fans out to each.
- **Kafka** — they must be in **different consumer groups** or they'd split the
  partitions between them. Storage = `iots-storage`, analytics = `iots-analytics`
  (`ANALYTICS_GROUP_ID`, deliberately distinct). That's "consumer group A vs B".

## The tumbling window

Fixed, non-overlapping, every `WINDOW_SIZE_SEC` (default 10s). A background task sleeps
one window, then **closes** it: average `temp` / `humidity` / `co` over the messages
received in that window, log a summary, record latency, reset the accumulator. Boundaries
are by **receive (wall-clock) time**. The accumulator keeps running sums (+ min/sum of
`sent_at_ms`) rather than a list of messages, so it's O(1) memory regardless of rate.

Logged in the spec format (REQUIREMENTS §5.3):

```
[ALERT] {iso} | Window [{start}–{end}] | AvgTemp: ..°F | AvgHumidity: ..% | AvgCO: ..ppm | THRESHOLD EXCEEDED
[INFO ] {iso} | Window [{start}–{end}] | AvgTemp: ..°F | AvgHumidity: ..% | AvgCO: ..ppm | OK
```

`[ALERT]` when `avg_temp > ALERT_THRESHOLD`, else `[INFO]`.

> Dataset note: the `temp` values sit around 19–31 (labelled °F in the dataset but
> Celsius-range numbers). With the default threshold `50` you get `[INFO]`/OK; drop the
> threshold to ~20 to exercise `[ALERT]`. Both branches verified.

## The two latencies (this is the heart of Scenario D)

| Metric | Formula | What it isolates |
|--------|---------|------------------|
| **Transport** | `received_at_ms − sent_at_ms`, per message | pure broker delivery (publish → consume) |
| **Event-to-alert** | `alert_log_ms − sent_at_ms`, per windowed message | end-to-end, *includes* up to `WINDOW_SIZE_SEC` of window buffering |

The spec's single metric is the event-to-alert one, which inherently bakes in window
buffering (a message arriving at the start of a 10s window waits ~10s before its window
closes). Reporting transport **alongside** it separates the broker's contribution from the
windowing delay. Verified: transport **~3 ms (MQTT) / ~10 ms (Kafka)** vs event-to-alert
**~1.4–1.7 s** with a 3s window — transport ≪ event-to-alert, exactly as expected.

A parseable line is also emitted per window for the benchmark parsers:
```
[LATENCY] window_end=.. msgs=N event_to_alert_ms_avg=.. event_to_alert_ms_max=..
```

## Control surface

FastAPI on `ANALYTICS_PORT` (3003): `GET /health`, `GET /stats` (messages, windows,
alerts, transport + event-to-alert latency summaries, last window). Two asyncio tasks
share the one event loop: the consume loop (adapter → window) and the window closer.

## Verified (2026-06-03, WSL2)

- **MQTT**, 30 dev @ 300 msg/s, 3s window: 900 msgs/window exactly; `[ALERT]` at
  threshold 20 (avg temp ~23), `[INFO]`/OK at threshold 50; transport avg ~3.2 ms,
  event-to-alert avg ~1.4 s.
- **Kafka**, same load: subscriber-first start works (own group `iots-analytics`);
  `[ALERT]` windows; transport avg ~10 ms (vs MQTT ~3 ms — consistent with storage),
  event-to-alert ~1.7 s.
- Image builds (`python:3.12-slim`); wired into compose under the `app` profile.

## If asked

- *"Why is analytics Python when the rest is Node?"* → The spec mandates FastAPI here; it
  also makes the broker-abstraction point in a second language. Same contract, conformant.
- *"Why two latencies?"* → Event-to-alert includes window buffering; transport isolates
  the broker. The MQTT-vs-Kafka story needs the broker part separated out.
- *"Won't storage and analytics steal each other's Kafka messages?"* → No — different
  consumer groups, so each group gets the whole stream.
- *"What sets a window boundary?"* → Wall-clock receive time, every `WINDOW_SIZE_SEC`,
  non-overlapping.
