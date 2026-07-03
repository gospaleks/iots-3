#!/usr/bin/env python3
"""Aggregate a docker-stats sample CSV into per-container avg/peak CPU and memory.

Input CSV (from collect-docker-stats.sh), one row per sample per container:
  iso_ts,container,cpu_percent,mem_mb,net_io

Usage:  parse_docker_stats.py samples.csv [--csv-header]
Output: one row per container:  container,samples,cpu_avg,cpu_peak,mem_avg_mb,mem_peak_mb
"""
from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("samples")
    ap.add_argument("--csv-header", action="store_true")
    args = ap.parse_args()

    cpu: dict[str, list[float]] = defaultdict(list)
    mem: dict[str, list[float]] = defaultdict(list)

    with open(args.samples, newline="") as fh:
        for row in csv.reader(fh):
            if len(row) < 4 or row[0] == "ts":
                continue
            container = row[1]
            try:
                cpu[container].append(float(row[2]))
                mem[container].append(float(row[3]))
            except ValueError:
                continue

    if args.csv_header:
        print("container,samples,cpu_avg,cpu_peak,mem_avg_mb,mem_peak_mb")

    for container in sorted(cpu):
        c, m = cpu[container], mem[container]
        print(
            f"{container},{len(c)},"
            f"{sum(c)/len(c):.2f},{max(c):.2f},"
            f"{sum(m)/len(m):.2f},{max(m):.2f}"
        )


if __name__ == "__main__":
    main()
