#!/bin/sh
# eKuiper provisioning — reproducible stream + rules via the REST API (no UI clicks).
#
# Runs as a one-shot init container (see docker-compose.yml: ekuiper-provision).
# Idempotent: DELETEs each object before (re)creating it, so re-runs never 409.
# Creates the STREAM before the rules. The GROUP BY window clause is built from
# env (D6) so the window type/size is switchable without editing any SQL.
set -eu

EKUIPER_URL="${EKUIPER_URL:-http://ekuiper:9081}"
RAW_TOPIC="${RAW_TOPIC:-sensors/telemetry}"
EVENTS_TOPIC="${EVENTS_TOPIC:-sensors/events}"
BROKER_URL="${BROKER_URL:-tcp://mosquitto:1883}"
WINDOW_TYPE="${WINDOW_TYPE:-tumbling}"
WINDOW_UNIT="${WINDOW_UNIT:-ss}"
WINDOW_SIZE="${WINDOW_SIZE:-10}"
WINDOW_STEP="${WINDOW_STEP:-}"
CO_HIGH="${CO_HIGH:-0.010}"

SRC=/ekuiper
TMP=/tmp/ekuiper
mkdir -p "$TMP"

# --- Build the GROUP BY window clause from env (D6). eKuiper v2 signatures. ---
case "$WINDOW_TYPE" in
  tumbling) WIN="TUMBLINGWINDOW($WINDOW_UNIT, $WINDOW_SIZE)";;
  hopping)  WIN="HOPPINGWINDOW($WINDOW_UNIT, $WINDOW_SIZE, $WINDOW_STEP)";;
  sliding)  WIN="SLIDINGWINDOW($WINDOW_UNIT, $WINDOW_SIZE${WINDOW_STEP:+, $WINDOW_STEP})";;
  session)  WIN="SESSIONWINDOW($WINDOW_UNIT, $WINDOW_SIZE, $WINDOW_STEP)";;
  count)    WIN="COUNTWINDOW($WINDOW_SIZE${WINDOW_STEP:+, $WINDOW_STEP})";;
  *) echo "[provision] unknown WINDOW_TYPE=$WINDOW_TYPE" >&2; exit 1;;
esac
echo "[provision] window clause: $WIN"

# --- Wait for the REST API (GET /streams returns 200 + [] once ready). ---
echo "[provision] waiting for $EKUIPER_URL ..."
i=0
until curl -sf "$EKUIPER_URL/streams" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -gt 60 ] && { echo "[provision] eKuiper REST not ready after 60s" >&2; exit 1; }
  sleep 1
done
echo "[provision] eKuiper REST is up."

# --- Stream (create only if missing; must exist before rules). It is a static
#     schema referenced by the running rules, so we do NOT drop-and-recreate it
#     (a DROP fails while rules reference it). This keeps re-runs idempotent. ---
if curl -sf "$EKUIPER_URL/streams/sensor_stream" >/dev/null 2>&1; then
  echo "[provision] stream sensor_stream already exists — skipping create"
else
  sed "s|__RAW_TOPIC__|$RAW_TOPIC|g" "$SRC/streams/sensor_stream.json" > "$TMP/sensor_stream.json"
  echo "[provision] creating stream sensor_stream (source=$RAW_TOPIC) ..."
  curl -sf -X POST "$EKUIPER_URL/streams" -H 'Content-Type: application/json' \
    --data @"$TMP/sensor_stream.json" \
    && echo "[provision] stream created" \
    || { echo "[provision] stream create FAILED" >&2; exit 1; }
fi

# --- Rules (substitute placeholders, DELETE-then-POST). ---
provision_rule() {
  id="$1"; file="$2"
  curl -s -X DELETE "$EKUIPER_URL/rules/$id" >/dev/null 2>&1 || true
  sed -e "s|__WIN__|$WIN|g" \
      -e "s|__CO_HIGH__|$CO_HIGH|g" \
      -e "s|__EVENTS_TOPIC__|$EVENTS_TOPIC|g" \
      -e "s|__BROKER_URL__|$BROKER_URL|g" \
      "$SRC/rules/$file" > "$TMP/$file"
  echo "[provision] creating rule $id ..."
  curl -sf -X POST "$EKUIPER_URL/rules" -H 'Content-Type: application/json' \
    --data @"$TMP/$file" \
    && echo "[provision] rule $id created" \
    || { echo "[provision] rule $id create FAILED" >&2; exit 1; }
}

provision_rule window_metrics window_metrics.json
provision_rule high_co high_co.json

echo "[provision] done. Registered rules:"
curl -s "$EKUIPER_URL/rules"
echo
