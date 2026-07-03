#!/usr/bin/env bash
# Scenario B matrix — runs the full connectivity-failure grid for one broker.
#
# Why a matrix: a single 30 s publisher outage is masked by the client library on BOTH
# brokers (mqtt.js buffers, kafkajs retries), so the result is identical and the broker's
# offline-delivery MECHANISM is never tested. To actually compare the brokers we disconnect
# the SUBSCRIBER (storage) and vary the knobs that decide MQTT's behaviour:
#   - clean_session false + stable CLIENT_ID + QoS>=1 → Mosquitto QUEUES while offline
#   - clean_session true   OR QoS 0                   → Mosquitto DROPS (nothing to resume)
#   - max_queued cap                                  → bounded broker RAM overflows → drops
# Kafka's durable log + consumer offsets resume with no loss regardless of these.
#
# For each variant we recreate ingestion+storage (and, for MQTT, the broker with a fresh
# session store) so variants don't contaminate each other, then call the core script.
#
# Usage:  BROKER=mqtt  ./scenario-b-matrix.sh
#         BROKER=kafka ./scenario-b-matrix.sh
# Prereq: dataset present (data/iot_telemetry_data.csv); docker compose available.

source "$(dirname "$0")/lib/common.sh"
require_cmd docker; require_cmd python3

COMPOSE_DIR="$REPO_DIR/docker"
ENV_FILE="$COMPOSE_DIR/.env"
ENV_BAK="$COMPOSE_DIR/.env.scenario-b.bak"
CONF="$REPO_DIR/docker/mosquitto/mosquitto.conf"
CONF_BAK="$CONF.scenario-b.bak"
RUN_OVERFLOW="${RUN_OVERFLOW:-1}"   # set 0 to skip the bounded-queue overflow variant

dc() { (cd "$COMPOSE_DIR" && docker compose "$@"); }

# --- point .env at the chosen broker (restored on exit) ---
cp "$ENV_FILE" "$ENV_BAK"
cp "$CONF" "$CONF_BAK"
restore() {
  log "restoring .env + mosquitto.conf"
  mv -f "$ENV_BAK" "$ENV_FILE" 2>/dev/null || true
  mv -f "$CONF_BAK" "$CONF" 2>/dev/null || true
}
trap restore EXIT

set_broker_env() {
  # TOPIC must match the broker: Kafka rejects '/' in topic names (sensors/telemetry).
  if [ "$BROKER" = kafka ]; then
    sed -i 's/^BROKER_TYPE=.*/BROKER_TYPE=kafka/;   s/^BROKER_HOST=.*/BROKER_HOST=kafka/;     s/^BROKER_PORT=.*/BROKER_PORT=9092/; s#^TOPIC=.*#TOPIC=sensor-telemetry#' "$ENV_FILE"
  else
    sed -i 's/^BROKER_TYPE=.*/BROKER_TYPE=mqtt/;    s/^BROKER_HOST=.*/BROKER_HOST=mosquitto/; s/^BROKER_PORT=.*/BROKER_PORT=1883/; s#^TOPIC=.*#TOPIC=sensors/telemetry#' "$ENV_FILE"
  fi
}

set_maxq() {  # arg: integer (0 = unlimited). Edits the conf; broker reloaded on next recreate.
  sed -i "s/^max_queued_messages .*/max_queued_messages $1/" "$CONF"
}

recreate() {  # args: qos clean keepalive   — bring up a clean app stack for this variant
  local qos="$1" clean="$2" keepalive="$3"
  dc --profile "$BROKER" --profile app rm -sf ingestion storage analytics >/dev/null 2>&1 || true
  if [ "$BROKER" = mqtt ]; then
    dc --profile mqtt rm -sf mosquitto >/dev/null 2>&1 || true
    docker volume rm iots2_mosquitto-data >/dev/null 2>&1 || true   # wipe persistent sessions
  fi
  QOS_LEVEL="$qos" MQTT_CLEAN_SESSION="$clean" MQTT_KEEPALIVE_SEC="$keepalive" \
    dc --profile "$BROKER" --profile app up -d >/dev/null
  wait_http "http://localhost:$STORAGE_PORT/health" 90 || die "storage didn't come up"
  sleep 12   # let the simulator + subscriber establish steady flow before the cut
}

variant() {  # args: name target qos clean outage maxq keepalive
  local name="$1" target="$2" qos="$3" clean="$4" outage="$5" maxq="$6" keepalive="${7:-60}"
  log "════════ variant: $name (target=$target qos=$qos clean=$clean outage=${outage}s maxq=$maxq keepalive=${keepalive}s) ════════"
  [ "$BROKER" = mqtt ] && set_maxq "$([ "$maxq" = unlimited ] && echo 0 || echo "$maxq")"
  recreate "$qos" "$clean" "$keepalive"
  VARIANT="$name" DISCONNECT_TARGET="$target" QOS_LEVEL="$qos" MQTT_CLEAN_SESSION="$clean" \
    OUTAGE_SEC="$outage" MAX_QUEUED="$maxq" KEEPALIVE="$keepalive" \
    "$BENCH_DIR/scenario-b-connectivity-failure.sh"
}

set_broker_env
log "Scenario B matrix on $BROKER"

if [ "$BROKER" = mqtt ]; then
  # keepalive=60 for the publisher baseline (client buffering masks the outage, as in the
  # naive test); keepalive=10 for the subscriber variants so the broker actually detects the
  # dead client inside a 30 s outage and clean-vs-persistent semantics become visible.
  #         name              target     qos clean   outage  maxq        keepalive
  variant   pub-baseline      ingestion  1   true    30      unlimited   60
  variant   sub-persistent    storage    1   false   30      unlimited   10
  variant   sub-clean         storage    1   true    30      unlimited   10
  variant   sub-qos0          storage    0   false   30      unlimited   10
  [ "$RUN_OVERFLOW" = 1 ] && \
  variant   sub-overflow      storage    1   false   30      10000       10
else
  #         name              target     qos clean   outage  maxq        keepalive
  variant   pub-baseline      ingestion  -   -       30      -           -
  variant   sub-resume        storage    -   -       30      -           -
  variant   sub-long          storage    -   -       90      -           -
fi

log "matrix done — summaries under results/$BROKER/scenario-b/"
