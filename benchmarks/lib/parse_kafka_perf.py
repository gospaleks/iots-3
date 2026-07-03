#!/usr/bin/env python3
"""Parse kafka-producer-perf-test.sh output into one CSV row.

The tool's final summary line looks like:
  50000 records sent, 24937.5 records/sec (2.38 MB/sec), 12.34 ms avg latency,
  350.00 ms max latency, 5 ms 50th, 30 ms 95th, 45 ms 99th, 60 ms 99.9th.

Usage:  kafka-producer-perf-test.sh ... | parse_kafka_perf.py [--label NAME] [--csv-header]
Output: label,records,records_per_sec,mb_per_sec,avg_ms,max_ms,p50_ms,p95_ms,p99_ms
"""
from __future__ import annotations

import argparse
import re
import sys

SUMMARY = re.compile(
    r"(?P<records>\d+)\s+records sent,\s+"
    r"(?P<rps>[\d.]+)\s+records/sec\s+\((?P<mbps>[\d.]+)\s+MB/sec\),\s+"
    r"(?P<avg>[\d.]+)\s+ms avg latency,\s+"
    r"(?P<max>[\d.]+)\s+ms max latency,\s+"
    r"(?P<p50>\d+)\s+ms 50th,\s+"
    r"(?P<p95>\d+)\s+ms 95th,\s+"
    r"(?P<p99>\d+)\s+ms 99th"
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="kafka")
    ap.add_argument("--csv-header", action="store_true")
    args = ap.parse_args()

    text = sys.stdin.read()
    # Use the LAST matching summary line (perf-test prints a final aggregate).
    match = None
    for m in SUMMARY.finditer(text):
        match = m

    if args.csv_header:
        print("label,records,records_per_sec,mb_per_sec,avg_ms,max_ms,p50_ms,p95_ms,p99_ms")

    if not match:
        print(f"{args.label},0,0,0,0,0,0,0,0", file=sys.stdout)
        print("parse_kafka_perf: no summary line found", file=sys.stderr)
        sys.exit(1)

    g = match.groupdict()
    print(
        f"{args.label},{g['records']},{g['rps']},{g['mbps']},"
        f"{g['avg']},{g['max']},{g['p50']},{g['p95']},{g['p99']}"
    )


if __name__ == "__main__":
    main()
