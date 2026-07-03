#!/usr/bin/env python3
"""Parse emqtt-bench (pub or sub) output into one CSV row.

emqtt-bench prints periodic lines:
  1s pub total=196 rate=195.41/sec
  2s pub total=396 rate=200.00/sec
  ...
  3s recv total=580 rate=200.00/sec     (subscriber side)

Usage:  emqtt_bench ... | parse_emqtt.py --kind pub|recv [--label NAME] [--csv-header]
Output: label,kind,total,peak_rate,last_rate
"""
from __future__ import annotations

import argparse
import re
import sys


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", choices=["pub", "recv"], default="pub")
    ap.add_argument("--label", default="emqtt")
    ap.add_argument("--csv-header", action="store_true")
    args = ap.parse_args()

    pat = re.compile(rf"\b{args.kind}\s+total=(\d+)\s+rate=([\d.]+)/sec")
    total = 0
    peak = 0.0
    last = 0.0
    for line in sys.stdin:
        m = pat.search(line)
        if not m:
            continue
        total = int(m.group(1))
        last = float(m.group(2))
        peak = max(peak, last)

    if args.csv_header:
        print("label,kind,total,peak_rate,last_rate")
    print(f"{args.label},{args.kind},{total},{peak:.2f},{last:.2f}")


if __name__ == "__main__":
    main()
