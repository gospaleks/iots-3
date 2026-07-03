#!/usr/bin/env bash
# Scenario B — Edge Connectivity Failure (REQUIREMENTS §7-B).
#
# Disconnect ONE service container from the broker network for OUTAGE_SEC, reconnect,
# and measure messages lost / recovery time / duplicates via the storage service's
# per-device seq tracker (gaps ⇒ lost, duplicates ⇒ redelivered).
#
# DISCONNECT_TARGET selects which end of the pipe drops:
#   storage    (default) → the SUBSCRIBER goes offline. This is the variant that
#                          actually exercises the broker's offline-delivery mechanism
#                          (MQTT persistent-session queue vs Kafka consumer offsets).
#   ingestion            → the PUBLISHER goes offline. Both client libraries buffer/
#                          retry, so this mostly measures the *client*, not the broker.
#
# The run records the parameters that decide the outcome (qos, clean_session, max_queued)
# so the result table is self-describing. For MQTT, the broker only queues for an offline
# subscriber when clean_session=false AND a stable CLIENT_ID AND QoS>=1 — vary these via
# the compose env (see scenario-b-matrix.sh, which orchestrates the full grid).
#
# Prereq: broker + app stack up →  docker compose --profile <broker> --profile app up -d
# Usage:  BROKER=mqtt DISCONNECT_TARGET=storage ./scenario-b-connectivity-failure.sh

source "$(dirname "$0")/lib/common.sh"
require_cmd docker; require_cmd python3

DISCONNECT_TARGET="${DISCONNECT_TARGET:-storage}"
case "$DISCONNECT_TARGET" in
  storage)   TARGET_CONTAINER="iots-storage" ;;
  ingestion) TARGET_CONTAINER="iots-ingestion" ;;
  *) die "DISCONNECT_TARGET must be 'storage' or 'ingestion' (got '$DISCONNECT_TARGET')" ;;
esac

require_container_running "iots-ingestion"
require_container_running "iots-storage"
require_container_running "$TARGET_CONTAINER"

OUT="$(results_dir b)"; RUN="$(ts)"
OUTAGE_SEC="${OUTAGE_SEC:-30}"
SETTLE_SEC="${SETTLE_SEC:-15}"
VARIANT="${VARIANT:-default}"
# Recorded-only labels (the actual values are set on the containers via compose env).
QOS_LABEL="${QOS_LEVEL:--}"
CLEAN_LABEL="${MQTT_CLEAN_SESSION:--}"
MAXQ_LABEL="${MAX_QUEUED:-unlimited}"
KEEPALIVE_LABEL="${KEEPALIVE:--}"
[ "$BROKER" = "kafka" ] && { QOS_LABEL="-"; CLEAN_LABEL="-"; MAXQ_LABEL="-"; KEEPALIVE_LABEL="-"; }

SUMMARY="$OUT/summary-${VARIANT}-$RUN.csv"

wait_http "http://localhost:$STORAGE_PORT/health" 30 || die "storage /health not responding"
log "Scenario B on $BROKER — variant=$VARIANT target=$DISCONNECT_TARGET outage=${OUTAGE_SEC}s qos=$QOS_LABEL clean=$CLEAN_LABEL maxq=$MAXQ_LABEL keepalive=$KEEPALIVE_LABEL"

snap() { get_stats "$STORAGE_PORT"; }
S0="$(snap)"
r0=$(json_get "$S0" "writer.received")
miss0=$(json_get "$S0" "seq.missing")
dup0=$(json_get "$S0" "seq.duplicates")
log "before: received=$r0 missing=$miss0 duplicates=$dup0"

log "disconnecting $TARGET_CONTAINER from $NETWORK"
docker network disconnect "$NETWORK" "$TARGET_CONTAINER"
disc_at=$(date +%s)
sleep "$OUTAGE_SEC"
log "reconnecting $TARGET_CONTAINER"
docker network connect "$NETWORK" "$TARGET_CONTAINER"
recon_at=$(date +%s)

# After a network re-attach the published port / HTTP server take a moment to answer again;
# wait for /health so the first /stats read below doesn't race on an empty body.
wait_http "http://localhost:$STORAGE_PORT/health" 30 || log "warn: storage /health slow after reconnect"

# Recovery: poll until storage's received count rises again (flow resumed).
# (storage /stats is only reachable while connected — we never poll during the outage.)
# Tolerate transient empty/non-numeric reads while the container settles.
num_received() { json_get "$(snap)" "writer.received" 2>/dev/null | grep -E '^[0-9]+$' || echo ""; }
prev="$(num_received)"
recovery_s=""
for i in $(seq 1 60); do
  sleep 1
  cur="$(num_received)"
  [ -z "$cur" ] && continue
  [ -z "$prev" ] && { prev="$cur"; continue; }
  if [ "$cur" -gt "$prev" ]; then recovery_s=$(( $(date +%s) - recon_at )); break; fi
  prev="$cur"
done
[ -z "$recovery_s" ] && recovery_s="-1"  # never recovered within window

sleep "$SETTLE_SEC"
S1="$(snap)"
r1=$(json_get "$S1" "writer.received")
miss1=$(json_get "$S1" "seq.missing")
dup1=$(json_get "$S1" "seq.duplicates")

lost=$(( miss1 - miss0 ))
dups=$(( dup1 - dup0 ))
echo "broker,variant,disconnect_target,outage_sec,qos,clean_session,max_queued,keepalive_s,messages_lost,duplicates,recovery_s,received_before,received_after" > "$SUMMARY"
echo "$BROKER,$VARIANT,$DISCONNECT_TARGET,$OUTAGE_SEC,$QOS_LABEL,$CLEAN_LABEL,$MAXQ_LABEL,$KEEPALIVE_LABEL,$lost,$dups,$recovery_s,$r0,$r1" >> "$SUMMARY"
log "after: lost(seq gaps)=$lost duplicates=$dups recovery=${recovery_s}s → $SUMMARY"
column -s, -t "$SUMMARY" >&2 || cat "$SUMMARY" >&2
