#!/usr/bin/env bash
# Scenario A — Massive Sensor Ingestion (REQUIREMENTS §7-A).
# Max throughput + message loss + CPU/RAM under heavy parallel load, using the
# MANDATED bench tools (emqtt-bench for MQTT, kafka-producer-perf-test for Kafka).
#
# Prereq: the broker stack is up →  docker compose --profile <broker> up -d
# Usage:  BROKER=mqtt  ./scenario-a-massive-ingestion.sh
#         BROKER=kafka ./scenario-a-massive-ingestion.sh
# Tunables (env): DEVICE_COUNTS, MSGS_PER_CLIENT, INTERVAL_MS, RECORD_SIZE, QOS, ACKS
#
# Output: results/<broker>/scenario-a/{summary.csv, resources-*.csv, raw logs}

source "$(dirname "$0")/lib/common.sh"

require_cmd docker; require_cmd python3
require_container_running "$BROKER_CONTAINER"

OUT="$(results_dir a)"
RUN="$(ts)"
DEVICE_COUNTS="${DEVICE_COUNTS:-100 1000}"   # spec: 100 1000 10000 (10000 is heavy)
MSGS_PER_CLIENT="${MSGS_PER_CLIENT:-200}"
INTERVAL_MS="${INTERVAL_MS:-20}"             # per-client publish interval (MQTT)
RECORD_SIZE="${RECORD_SIZE:-200}"            # payload bytes
QOS="${QOS:-1}"; ACKS="${ACKS:-1}"

SUMMARY="$OUT/summary-$RUN.csv"
echo "broker,config,device_count,sent,received,loss_pct,throughput_msg_s,p95_latency_ms,note" > "$SUMMARY"
log "Scenario A on $BROKER → $SUMMARY"

run_mqtt() {
  local clients="$1"
  local total=$(( clients * MSGS_PER_CLIENT ))
  local raw="$OUT/a-mqtt-c${clients}-$RUN"
  log "MQTT: clients=$clients total=$total interval=${INTERVAL_MS}ms qos=$QOS"

  local pub_dur=$(( MSGS_PER_CLIENT * INTERVAL_MS / 1000 ))
  # Subscriber counts received over the run (sub has no -L; stop it via timeout).
  timeout $(( pub_dur + 12 )) docker run --rm --network "$NETWORK" emqx/emqtt-bench:latest \
    sub -h "$MQTT_HOST_INNET" -p "$MQTT_PORT_INNET" -t "$TOPIC" -q "$QOS" -c 1 \
    > "$raw-sub.log" 2>&1 &
  local sub_pid=$!
  sleep 2  # let the subscriber attach before publishing

  DURATION=$(( pub_dur + 8 )) INTERVAL=2 \
    OUT="$raw-resources.csv" "$BENCH_DIR/collect-docker-stats.sh" &
  local stats_pid=$!

  timeout 120 docker run --rm --network "$NETWORK" emqx/emqtt-bench:latest \
    pub -h "$MQTT_HOST_INNET" -p "$MQTT_PORT_INNET" -c "$clients" -I "$INTERVAL_MS" \
    -t "$TOPIC" -s "$RECORD_SIZE" -q "$QOS" -L "$total" > "$raw-pub.log" 2>&1 || true

  wait "$sub_pid" 2>/dev/null || true
  wait "$stats_pid" 2>/dev/null || true

  # -L guarantees exactly $total published; parse the peak rate for throughput.
  local sent="$total" recv peak
  peak=$(python3 "$LIB_DIR/parse_emqtt.py" --kind pub  < "$raw-pub.log" | cut -d, -f4)
  recv=$(python3 "$LIB_DIR/parse_emqtt.py" --kind recv < "$raw-sub.log" | cut -d, -f3)
  local loss; loss=$(python3 -c "s=$sent or 0; r=$recv or 0; print(f'{(s-r)/s*100:.2f}' if s else '0')")
  # emqtt-bench pub reports rate, not per-message latency → p95 N/A for MQTT here.
  echo "$BROKER,qos$QOS,$clients,$sent,$recv,$loss,$peak,NA,interval=${INTERVAL_MS}ms" >> "$SUMMARY"
  python3 "$LIB_DIR/parse_docker_stats.py" "$raw-resources.csv" --csv-header > "$raw-resources-agg.csv" 2>/dev/null || true
}

run_kafka() {
  local count="$1"
  local total=$(( count * MSGS_PER_CLIENT ))
  local raw="$OUT/a-kafka-n${count}-$RUN"
  log "Kafka: num-records=$total throughput=max acks=$ACKS size=${RECORD_SIZE}B"

  DURATION=20 INTERVAL=2 OUT="$raw-resources.csv" "$BENCH_DIR/collect-docker-stats.sh" &
  local stats_pid=$!

  docker exec "$BROKER_CONTAINER" /opt/kafka/bin/kafka-producer-perf-test.sh \
    --topic "$TOPIC" --num-records "$total" --record-size "$RECORD_SIZE" --throughput -1 \
    --producer-props bootstrap.servers=localhost:9092 acks="$ACKS" \
    > "$raw-perf.log" 2>&1 || true

  # Count received via a fresh consumer reading the just-produced records.
  local recv
  recv=$(timeout 60 docker exec "$BROKER_CONTAINER" /opt/kafka/bin/kafka-console-consumer.sh \
    --bootstrap-server localhost:9092 --topic "$TOPIC" --from-beginning \
    --max-messages "$total" --timeout-ms 15000 2>/dev/null | wc -l || echo 0)

  wait "$stats_pid" 2>/dev/null || true

  local row sent tput p95 avg
  row=$(python3 "$LIB_DIR/parse_kafka_perf.py" < "$raw-perf.log")
  sent=$(echo "$row" | cut -d, -f2); tput=$(echo "$row" | cut -d, -f3)
  avg=$(echo "$row" | cut -d, -f5); p95=$(echo "$row" | cut -d, -f8)
  local loss; loss=$(python3 -c "s=$sent or 0; r=$recv or 0; print(f'{(s-r)/s*100:.2f}' if s else '0')")
  echo "$BROKER,acks$ACKS,$count,$sent,$recv,$loss,$tput,$p95,avg=${avg}ms" >> "$SUMMARY"
  python3 "$LIB_DIR/parse_docker_stats.py" "$raw-resources.csv" --csv-header > "$raw-resources-agg.csv" 2>/dev/null || true
}

for c in $DEVICE_COUNTS; do
  if [ "$BROKER" = "mqtt" ]; then run_mqtt "$c"; else run_kafka "$c"; fi
done

log "done. summary:"; column -s, -t "$SUMMARY" >&2 || cat "$SUMMARY" >&2
