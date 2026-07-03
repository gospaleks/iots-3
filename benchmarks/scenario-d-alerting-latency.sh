#!/usr/bin/env bash
# Scenario D — Real-Time Alerting Latency (REQUIREMENTS §7-D).
# Collect transport + event-to-alert latency while the simulator publishes. Run it
# once per QoS/acks setting to compare delivery-guarantee impact (set QOS_LEVEL /
# KAFKA_ACKS on the stack and re-up before each run — documented in benchmarks/README.md).
#
# Prereq: broker + app stack up (ingestion publishing, analytics running).
#         Use a low ALERT_THRESHOLD so windows actually fire [ALERT] (dataset temps ~22).
# Usage:  BROKER=mqtt ./scenario-d-alerting-latency.sh
# Tunables: WATCH_SEC, ANALYTICS_LOG_CMD (default: docker logs iots-analytics)

source "$(dirname "$0")/lib/common.sh"
require_cmd python3
wait_http "http://localhost:$ANALYTICS_PORT/health" 30 || die "analytics /health not responding"

OUT="$(results_dir d)"; RUN="$(ts)"
WATCH_SEC="${WATCH_SEC:-40}"
ANALYTICS_LOG_CMD="${ANALYTICS_LOG_CMD:-docker logs --since ${WATCH_SEC}s iots-analytics}"
SUMMARY="$OUT/summary-$RUN.csv"
RAW="$OUT/d-$BROKER-$RUN"

log "Scenario D on $BROKER — watching ${WATCH_SEC}s (qos=${QOS_LEVEL:-?} acks=${KAFKA_ACKS:-?})"
log "let the simulator + analytics run; collecting window [LATENCY] lines"
sleep "$WATCH_SEC"

# Pull analytics output and extract per-window event-to-alert averages.
$ANALYTICS_LOG_CMD > "$RAW-analytics.log" 2>&1 || true
grep -oE 'event_to_alert_ms_avg=[0-9.]+' "$RAW-analytics.log" | cut -d= -f2 \
  > "$RAW-e2a-samples.txt" || true

# Percentiles across windows (proxy distribution for event-to-alert latency).
{
  python3 "$LIB_DIR/latency_stats.py" --label "event_to_alert_${BROKER}_qos${QOS_LEVEL:-NA}_acks${KAFKA_ACKS:-NA}" --csv-header \
    < "$RAW-e2a-samples.txt"
} > "$SUMMARY"

# Transport latency (avg/max) straight from analytics /stats.
ST="$(get_stats "$ANALYTICS_PORT")"
t_avg=$(json_get "$ST" "transportLatencyMs.avg"); t_max=$(json_get "$ST" "transportLatencyMs.max")
msgs=$(json_get "$ST" "messages"); alerts=$(json_get "$ST" "alerts")
{
  echo ""
  echo "transport_latency_ms_avg,transport_latency_ms_max,messages,alerts"
  echo "$t_avg,$t_max,$msgs,$alerts"
} >> "$SUMMARY"

log "transport avg=${t_avg}ms max=${t_max}ms over $msgs msgs ($alerts alerts)"
cat "$SUMMARY" >&2
