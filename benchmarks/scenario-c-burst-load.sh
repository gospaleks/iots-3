#!/usr/bin/env bash
# Scenario C — Burst Event Load (REQUIREMENTS §7-C).
# Abrupt baseline → peak (5000 msg/s) burst via the simulator's POST /burst, while
# sampling the storage service for backlog (buffered), throughput, and recovery.
#
# Prereq: broker + app stack up, simulator running at the baseline rate.
#         For a true 50→5000 baseline, start ingestion with NUM_DEVICES*MESSAGES_PER_SECOND≈50
#         (e.g. NUM_DEVICES=5 MESSAGES_PER_SECOND=10) and BURST_TARGET_RATE=5000.
# Usage:  BROKER=mqtt ./scenario-c-burst-load.sh

source "$(dirname "$0")/lib/common.sh"
require_cmd docker; require_cmd python3
wait_http "http://localhost:$INGESTION_PORT/health" 30 || die "ingestion /health not responding"
wait_http "http://localhost:$STORAGE_PORT/health" 30  || die "storage /health not responding"

OUT="$(results_dir c)"; RUN="$(ts)"
BURST_SEC="${BURST_SEC:-5}"
SAMPLE_SEC="${SAMPLE_SEC:-1}"
WATCH_SEC="${WATCH_SEC:-40}"          # total sampling window (covers burst + recovery)
SERIES="$OUT/timeseries-$RUN.csv"
SUMMARY="$OUT/summary-$RUN.csv"

echo "t_s,ingestion_published,storage_received,storage_buffered,storage_stored,bursting" > "$SERIES"
log "Scenario C on $BROKER — burst ${BURST_SEC}s, watching ${WATCH_SEC}s"

DURATION=$WATCH_SEC INTERVAL=2 OUT="$OUT/resources-$RUN.csv" "$BENCH_DIR/collect-docker-stats.sh" &
stats_pid=$!

# Baseline snapshot, then fire the burst.
miss0=$(json_get "$(get_stats "$STORAGE_PORT")" "seq.missing")
log "firing burst → POST /burst?durationSec=$BURST_SEC"
curl -s -X POST "http://localhost:$INGESTION_PORT/burst?durationSec=$BURST_SEC" >/dev/null || die "burst trigger failed"

start=$(date +%s); peak_backlog=0
while [ $(( $(date +%s) - start )) -lt "$WATCH_SEC" ]; do
  t=$(( $(date +%s) - start ))
  ist=$(get_stats "$INGESTION_PORT"); sst=$(get_stats "$STORAGE_PORT")
  pub=$(json_get "$ist" "published"); bursting=$(json_get "$ist" "bursting")
  recv=$(json_get "$sst" "writer.received"); buf=$(json_get "$sst" "writer.buffered"); sto=$(json_get "$sst" "writer.stored")
  echo "$t,$pub,$recv,$buf,$sto,$bursting" >> "$SERIES"
  [ "$buf" -gt "$peak_backlog" ] && peak_backlog="$buf"
  sleep "$SAMPLE_SEC"
done

wait "$stats_pid" 2>/dev/null || true
miss1=$(json_get "$(get_stats "$STORAGE_PORT")" "seq.missing")
lost=$(( miss1 - miss0 ))

# Recovery time: first sample after burst end where buffered returns near 0.
recovery_s=$(python3 - "$SERIES" "$BURST_SEC" <<'PY'
import csv,sys
series, burst = sys.argv[1], float(sys.argv[2])
rows=[r for r in csv.DictReader(open(series))]
rec=-1
for r in rows:
    if float(r["t_s"])>=burst and int(r["storage_buffered"])<=50:
        rec=int(float(r["t_s"])-burst); break
print(rec)
PY
)

echo "broker,baseline_to_peak,burst_sec,peak_backlog_buffered,messages_lost,recovery_s" > "$SUMMARY"
echo "$BROKER,->5000,$BURST_SEC,$peak_backlog,$lost,$recovery_s" >> "$SUMMARY"
log "peak backlog(buffered)=$peak_backlog lost=$lost recovery=${recovery_s}s"
column -s, -t "$SUMMARY" >&2 || cat "$SUMMARY" >&2
