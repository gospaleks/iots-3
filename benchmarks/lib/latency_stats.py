#!/usr/bin/env python3
"""Compute latency statistics from a stream of numbers (one per line on stdin).

Usage:  some_source | latency_stats.py [--label NAME] [--csv-header]
Output: a single CSV row: label,count,min,avg,p50,p95,p99,max
"""
from __future__ import annotations

import argparse
import sys


def percentile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    # nearest-rank
    k = max(0, min(len(sorted_vals) - 1, int(round(p / 100.0 * (len(sorted_vals) - 1)))))
    return sorted_vals[k]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="latency")
    ap.add_argument("--csv-header", action="store_true")
    args = ap.parse_args()

    vals = []
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            vals.append(float(line))
        except ValueError:
            continue

    if args.csv_header:
        print("label,count,min,avg,p50,p95,p99,max")

    if not vals:
        print(f"{args.label},0,0,0,0,0,0,0")
        return

    vals.sort()
    count = len(vals)
    mn = vals[0]
    mx = vals[-1]
    avg = sum(vals) / count
    print(
        f"{args.label},{count},{mn:.2f},{avg:.2f},"
        f"{percentile(vals,50):.2f},{percentile(vals,95):.2f},"
        f"{percentile(vals,99):.2f},{mx:.2f}"
    )


if __name__ == "__main__":
    main()
