# Shared helpers for the benchmark scenario runners. Source this from each script.
#
#   BROKER=mqtt|kafka            which broker stack is under test (default mqtt)
#   The relevant compose stack must already be up (see benchmarks/README.md):
#     A     → broker only        docker compose --profile <broker> up -d
#     B/C/D → broker + app        docker compose --profile <broker> --profile app up -d
#
# This file only defines functions/vars; it runs nothing.

set -euo pipefail

BROKER="${BROKER:-mqtt}"
NETWORK="${NETWORK:-iots2_iot-net}"

# Repo paths (resolve relative to this lib, so scripts work from any CWD).
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(cd "$LIB_DIR/.." && pwd)"
REPO_DIR="$(cd "$BENCH_DIR/.." && pwd)"

# Broker-specific endpoints / names.
case "$BROKER" in
  mqtt)
    BROKER_CONTAINER="iots-mosquitto"
    # In-network endpoint used by containerized load tools.
    MQTT_HOST_INNET="mosquitto"; MQTT_PORT_INNET=1883
    TOPIC_DEFAULT="sensors/telemetry"
    ;;
  kafka)
    BROKER_CONTAINER="iots-kafka"
    TOPIC_DEFAULT="sensor-telemetry"
    ;;
  *)
    echo "ERROR: BROKER must be 'mqtt' or 'kafka' (got '$BROKER')" >&2; exit 2 ;;
esac

TOPIC="${TOPIC:-$TOPIC_DEFAULT}"

# Control/stat ports of the app services (published by compose / host runs).
INGESTION_PORT="${INGESTION_PORT:-3001}"
STORAGE_PORT="${STORAGE_PORT:-3002}"
ANALYTICS_PORT="${ANALYTICS_PORT:-3003}"

log()  { echo "[$(date +%H:%M:%S)] $*" >&2; }
die()  { echo "ERROR: $*" >&2; exit 1; }

ts()   { date +%Y%m%d-%H%M%S; }

# results/<broker>/scenario-<x>/  — created on demand.
results_dir() {
  local scenario="$1"
  local d="$REPO_DIR/results/$BROKER/scenario-$scenario"
  mkdir -p "$d"; echo "$d"
}

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }

require_container_running() {
  docker ps --format '{{.Names}}' | grep -qx "$1" || die "container '$1' not running (bring up the stack first)"
}

# Poll an HTTP endpoint until it answers (bounded). Args: url [max_tries]
wait_http() {
  local url="$1" tries="${2:-60}"
  for _ in $(seq 1 "$tries"); do curl -sf "$url" >/dev/null 2>&1 && return 0; sleep 1; done
  return 1
}

# GET a service /stats JSON. Args: port
get_stats() { curl -s "http://localhost:$1/stats"; }

# Extract a (possibly nested, dotted) numeric field from a /stats JSON via python.
# Args: json  dotted.path
json_get() {
  python3 -c 'import sys,json
d=json.loads(sys.argv[1])
for k in sys.argv[2].split("."):
    d=d[k]
print(d)' "$1" "$2"
}
