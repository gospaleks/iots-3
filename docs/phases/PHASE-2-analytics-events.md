# PHASE 2 — Analytics consumes eKuiper events

> Part of `IMPLEMENTATION_PLAN.md`. Read `SESSION_STATE.md` first.

## 0. Context to load first
- Read: `IMPLEMENTATION_PLAN.md` §1, §2.2, §2.5; `docs/IoTS-3-EXPLAINED.md` §6; REPO-STATE §3
  ("Analytics internals").
- Depends on: **Phase 1 DONE** (events land on `sensors/events`).
- Invariants: Analytics stays thin — **no feature engineering here** (D4); it only routes,
  buffers rollups, and logs. MaaS wiring comes in Phase 5.

## 1. Goal
Repoint the FastAPI Analytics service from the raw topic to `sensors/events`, drop the Project 2
hand-rolled tumbling window, route incoming messages by `event_type`, and maintain a per-device
ring buffer of the last `LAG_WINDOWS` `WINDOW_METRICS`. For now it just **logs** events — this
isolates the eKuiper→Analytics leg before ML is added.

## 2. Entry criteria
- Phase 1 acceptance passed; `sensors/events` carries `WINDOW_METRICS` (+ `HIGH_CO`).
- `.env` has `EVENTS_TOPIC=sensors/events`, `LAG_WINDOWS=4`.

## 3. Steps
1. **Config** (`app/config.py`): add `EVENTS_TOPIC` (default `sensors/events`) and `LAG_WINDOWS`
   (default 4). Keep the hard reject of `BROKER_TYPE != mqtt`. The old `TOPIC` may remain unused
   or be repurposed; the subscribe target becomes `EVENTS_TOPIC`.
2. **Subscribe** (`app/main.py`): change the consume loop to subscribe to `EVENTS_TOPIC`. Parse
   each JSON message; branch on `event_type`.
3. **Remove self-windowing:** delete/retire `app/window.py` usage (eKuiper owns windowing, D9).
   Keep the transport-latency metric if useful (`sent_at_ms` isn't in events though — see note).
4. **Per-device rollup buffer:** add a small structure `dict[device] -> deque(maxlen=LAG_WINDOWS)`.
   On `WINDOW_METRICS`, append the aggregate dict. On event-of-interest types, just log for now.
5. **Log clearly:**
   ```
   [INFO]  WINDOW_METRICS device=… avg_temp=26.1 buffer=4/4
   [EVENT] HIGH_CO       device=… co=0.011
   ```
6. Keep `GET /health` and `/stats`; extend `/stats` with per-device buffer depth and
   events-seen counters.

## 4. Files created / modified
- `services/analytics-service/app/{config,main}.py` (modified)
- retire `app/window.py` (or leave dead-coded, clearly marked)
- `SESSION_STATE.md` (write-back)

## 5. Acceptance criteria (exit gate)
- [ ] Analytics subscribes to `sensors/events` (not the raw topic).
- [ ] `WINDOW_METRICS` fills a per-device buffer up to `LAG_WINDOWS`; buffer depth visible in `/stats`.
- [ ] Event-of-interest types are logged distinctly.
- [ ] No references to the P2 tumbling window remain in the active path.

## 6. How to verify
```bash
docker compose up -d analytics
docker compose logs -f analytics    # expect [INFO] WINDOW_METRICS … buffer=…/4 and [EVENT] lines
curl -s http://localhost:3003/stats | jq
```

## 7. Write back to SESSION_STATE.md
- Phase 2 → ✅ DONE; note buffer depth + which event types are flowing; Next → Phase 3 (if not
  already done in parallel) then Phase 4/5.

## 8. Notes / gotchas
- **Event time vs send time:** `sensors/events` carries `window_start/window_end` (event time),
  not `sent_at_ms`. If you want a Phase-5 "event-to-alert" latency, stamp Analytics' own
  receive/decision time; don't expect `sent_at_ms` on eKuiper output.
- Reuse the existing Python broker adapter (`app/broker/…`); only the topic changes.
