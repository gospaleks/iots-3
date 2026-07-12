# PHASE 6 — eKuiper advanced rules (depth)

> Part of `IMPLEMENTATION_PLAN.md`. Read `SESSION_STATE.md` first.

## 0. Context to load first
- Read: `IMPLEMENTATION_PLAN.md` §2.2, §3; `docs/IoTS-3-EXPLAINED.md` §4.6; the Phase 1 doc.
- Depends on: **Phase 1 DONE** (stream + provisioning in place). Best done after Phase 5 so you
  can see enriched alerts fire, but only technically needs Phase 1.
- Invariants: same sink topic `sensors/events`; same env-templated window mechanism;
  thresholds from env (D8).

## 1. Goal
Add the two "real CEP" rules that show range beyond a single filter: a **windowed sustained**
condition and a **multi-condition correlation**, both grouped per device and provisioned the same
reproducible way. This satisfies the spec's "2–3 meaningful rules demonstrating genuine stream
processing."

## 2. Entry criteria
- Phase 1 acceptance passed; `provision.sh` + window templating working.
- `.env` has `SUSTAINED_TEMP`, `TEMP_HIGH`, `HUMIDITY_LOW`, `SMOKE_HIGH`.

## 3. Steps
1. **SUSTAINED_HIGH_TEMP** (windowed aggregation with `HAVING`) — the same window as the rollup:
   ```sql
   SELECT device, AVG(temp) AS avg_temp, MAX(temp) AS max_temp,
          AVG(humidity) AS avg_humidity, AVG(co) AS avg_co,
          COUNT(*) AS sample_count,
          window_start() AS window_start, window_end() AS window_end,
          'SUSTAINED_HIGH_TEMP' AS event_type
   FROM sensor_stream
   GROUP BY device, <WIN>
   HAVING AVG(temp) > <SUSTAINED_TEMP>
   ```
2. **HEAT_DRYING** (correlation: warm **and** dry sustained) — scores well as "complex event":
   ```sql
   SELECT device, AVG(temp) AS avg_temp, AVG(humidity) AS avg_humidity,
          'HEAT_DRYING' AS event_type
   FROM sensor_stream
   GROUP BY device, <WIN>
   HAVING AVG(temp) > <TEMP_HIGH> AND AVG(humidity) < <HUMIDITY_LOW>
   ```
   (Optionally a rate-of-change variant using a sliding window to catch *rising* temp.)
3. Add each as `ekuiper/rules/sustained_high_temp.json` and `ekuiper/rules/heat_drying.json`,
   both with the MQTT sink to `sensors/events`, and extend `provision.sh` to POST them (with the
   same `$WIN` substitution + threshold substitution). Keep provisioning idempotent.
4. **Tune thresholds** against live data so events are meaningful but not constant (recall only
   `1c:bf` reaches high temp; `SUSTAINED_TEMP=25` is a good starting point).
5. Ensure Analytics (Phase 5) already routes these `event_type`s into the enriched-alert path —
   it should, since it branches on any non-`WINDOW_METRICS` type.

## 4. Files created / modified
- `ekuiper/rules/sustained_high_temp.json`, `ekuiper/rules/heat_drying.json`
- `ekuiper/provision.sh` (POST the new rules)

## 5. Acceptance criteria (exit gate)
- [x] At least three event rules total exist (`HIGH_CO`, `SUSTAINED_HIGH_TEMP`, `HEAT_DRYING`)
      plus the rollup, all provisioned automatically. *(verified: `GET /rules` shows all 4 `status: "running"`)*
- [x] Each fires visibly on `sensors/events` under appropriate conditions.
      *(SUSTAINED_HIGH_TEMP on `1c:bf:ce:15:ec:4d-*` at defaults; HIGH_CO fires when threshold lowered; HEAT_DRYING wired — silent at defaults because dataset humidity stays ~60)*
- [x] Analytics produces enriched alerts for the new event types (forecast attached).
      *(verified: `SUSTAINED_HIGH_TEMP (avg 25.6°C) | MaaS=next 27.6°C | pre-emptive` streaming)*
- [x] Rules survive a full `docker compose down && up` (REST-provisioned, not UI-only).
      *(verified: fresh clean-boot re-runs `provision.sh`, all 4 rules end `running` in ~10s)*

## 6. How to verify
```bash
docker compose up ekuiper ekuiper-provision -d
curl -s http://localhost:9081/rules | jq '.[].id'
mosquitto_sub -h localhost -t 'sensors/events' -v | grep -E 'SUSTAINED_HIGH_TEMP|HEAT_DRYING'
```

## 7. Write back to SESSION_STATE.md
- Phase 6 → ✅ DONE; list the active rule set + thresholds in effect; Next → Phase 7.

## 8. Notes / gotchas
- `WHERE` = per-message (pre-aggregation); `HAVING` = on the window aggregate. Correlations on
  averages go in `HAVING`.
- Keep window **size** aligned with `train.py` (§2.5) if these windowed aggregates ever feed the
  forecast buffer; the rollup remains the canonical forecast feed.
