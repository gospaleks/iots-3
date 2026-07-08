"""Shared feature transform — the SINGLE source of truth for building model input.

Imported verbatim by both `train.py` (offline) and the MaaS service (`/predict`, Phase 4).
Train/serve skew is the #1 MaaS bug, so there is exactly one `feature_vector` and one set
of `FEATURE_NAMES`; nothing else may build features.

Numeric invariants come from env so they match eKuiper provision and the Analytics buffer
(see shared/thresholds.md, IMPLEMENTATION_PLAN §2.5):
  - WINDOW_SIZE   (default 10, seconds)  — window length used to synthesize training aggregates.
  - LAG_WINDOWS   (default 4)            — number of window aggregates in one feature vector.

The aggregate dict schema matches the eKuiper `WINDOW_METRICS` rollup (message-contract §2.2):
  avg_temp, max_temp, min_temp, avg_humidity, avg_co, avg_lpg, avg_smoke,
  sample_count, window_start, window_end.
"""
from __future__ import annotations

import os
import re
from statistics import mean, pstdev

WINDOW_SIZE_SEC = int(os.getenv("WINDOW_SIZE", "10"))
LAG_WINDOWS = int(os.getenv("LAG_WINDOWS", "4"))

# Canonical device order for the one-hot (the three dataset devices, see dataset_info.md).
DEVICES: tuple[str, ...] = (
    "00:0f:00:70:91:0a",  # stable, cooler, more humid
    "1c:bf:ce:15:ec:4d",  # highly variable
    "b8:27:eb:bf:9d:51",  # stable, warmer, dryer
)

_SUFFIX_RE = re.compile(r"-\d+$")


def base_device(device: str) -> str:
    """Map a simulated device id back to its dataset MAC.

    Ingestion fans the 3 dataset devices out to NUM_DEVICES simulated ones by appending
    `-<n>` (e.g. `00:0f:00:70:91:0a-27`). Training sees the bare MACs; serving sees the
    suffixed ids. Normalizing here keeps the one-hot consistent across train and serve.
    """
    return _SUFFIX_RE.sub("", device)


def _device_one_hot(device: str) -> list[float]:
    base = base_device(device)
    return [1.0 if base == d else 0.0 for d in DEVICES]


# Feature layout (kept in lock-step with feature_vector below).
FEATURE_NAMES: list[str] = (
    [f"avg_temp_lag{i}" for i in range(LAG_WINDOWS)]
    + [f"avg_humidity_lag{i}" for i in range(LAG_WINDOWS)]
    + [f"avg_co_lag{i}" for i in range(LAG_WINDOWS)]
    + ["latest_max_temp", "roll_mean_avg_temp", "roll_std_avg_temp", "trend_avg_temp"]
    + [f"device_{d}" for d in DEVICES]
)


def feature_vector(history: list[dict], device: str) -> list[float]:
    """Build the flat model input from the last LAG_WINDOWS aggregate dicts (oldest→newest).

    This is the exact function the service calls at serve time. `history` must have
    length LAG_WINDOWS; raises ValueError otherwise so train/serve mismatches fail loudly.
    """
    if len(history) != LAG_WINDOWS:
        raise ValueError(f"expected {LAG_WINDOWS} history windows, got {len(history)}")

    avg_temp = [float(h["avg_temp"]) for h in history]
    avg_humidity = [float(h["avg_humidity"]) for h in history]
    avg_co = [float(h["avg_co"]) for h in history]
    latest_max_temp = float(history[-1]["max_temp"])

    roll_mean = mean(avg_temp)
    roll_std = pstdev(avg_temp) if len(avg_temp) > 1 else 0.0
    trend = avg_temp[-1] - avg_temp[0]

    return (
        avg_temp
        + avg_humidity
        + avg_co
        + [latest_max_temp, roll_mean, roll_std, trend]
        + _device_one_hot(device)
    )


def windows_from_readings(rows: list[dict], window_size_sec: int = WINDOW_SIZE_SEC) -> list[dict]:
    """Bucket one device's time-ordered raw readings into non-overlapping windows.

    Training-only: synthesizes the aggregate stream eKuiper would emit live. `rows` must be
    a single device's readings sorted by `ts` (epoch seconds). Empty buckets are skipped, so
    the returned list is the device's ordered aggregate series (gaps collapse — matching the
    serve-time buffer, which just holds the last N rollups received).
    """
    if not rows:
        return []

    windows: list[dict] = []
    bucket: list[dict] = []
    cur_key: int | None = None

    def flush(key: int, items: list[dict]) -> None:
        temps = [r["temp"] for r in items]
        windows.append({
            "avg_temp": mean(temps),
            "max_temp": max(temps),
            "min_temp": min(temps),
            "avg_humidity": mean(r["humidity"] for r in items),
            "avg_co": mean(r["co"] for r in items),
            "avg_lpg": mean(r["lpg"] for r in items),
            "avg_smoke": mean(r["smoke"] for r in items),
            "sample_count": len(items),
            "window_start": float(key * window_size_sec),
            "window_end": float((key + 1) * window_size_sec),
        })

    for r in rows:
        key = int(float(r["ts"]) // window_size_sec)
        if cur_key is None:
            cur_key = key
        if key != cur_key:
            flush(cur_key, bucket)
            bucket = []
            cur_key = key
        bucket.append(r)
    if bucket and cur_key is not None:
        flush(cur_key, bucket)

    return windows
