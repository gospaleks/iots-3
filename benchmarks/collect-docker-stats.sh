#!/usr/bin/env bash
# Sample `docker stats` for the iots-* containers into a CSV over a fixed window.
# Mandatory resource-monitoring baseline (REQUIREMENTS §8.3).
#
#   OUT=results/.../stats.csv DURATION=30 INTERVAL=2 ./collect-docker-stats.sh
#
# CSV columns: ts,container,cpu_percent,mem_mb,net_io
# Run it in the background alongside a scenario, matching DURATION to the run.

set -euo pipefail

OUT="${OUT:-docker-stats-$(date +%Y%m%d-%H%M%S).csv}"
INTERVAL="${INTERVAL:-2}"
DURATION="${DURATION:-30}"
FILTER="${FILTER:-iots-}"   # name prefix to keep

mkdir -p "$(dirname "$OUT")"
echo "ts,container,cpu_percent,mem_mb,net_io" > "$OUT"

end=$(( $(date +%s) + DURATION ))
while [ "$(date +%s)" -lt "$end" ]; do
  now="$(date -Iseconds)"
  # Name|CPU%|MemUsage|NetIO  → filter, normalize units, append rows.
  docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}' 2>/dev/null \
    | grep "$FILTER" \
    | while IFS='|' read -r name cpu mem net; do
        python3 - "$now" "$name" "$cpu" "$mem" "$net" >> "$OUT" <<'PY'
import re, sys
now, name, cpu, mem, net = sys.argv[1:6]
cpu_v = cpu.replace('%', '').strip() or '0'
# MemUsage like "12.34MiB / 1.5GiB" → used part to MB
used = mem.split('/')[0].strip()
m = re.match(r'([\d.]+)\s*([KMGT]?i?B)', used)
mb = 0.0
if m:
    val = float(m.group(1)); unit = m.group(2)
    factor = {'B':1/1e6,'KiB':1/1024,'MiB':1,'GiB':1024,'TiB':1024*1024,
              'kB':1/1000,'MB':1,'GB':1000,'TB':1e6}.get(unit, 1)
    mb = val * factor
net_clean = net.replace(',', ' ').strip()
print(f"{now},{name},{cpu_v},{mb:.2f},{net_clean}")
PY
      done
  sleep "$INTERVAL"
done

echo "wrote $OUT" >&2
