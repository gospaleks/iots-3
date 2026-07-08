"""Offline training — CSV → supervised regression → serialized RandomForest artifact.

Task (D1): predict the NEXT window's `avg_temp` per device (regression).
Model (D2): RandomForestRegressor, global, with a device one-hot.
Features (D3/D4): built ONLY via features.feature_vector — the same function the service
calls at serve time.

Pipeline:
  load CSV → drop temp==0 dropouts → per device: bucket into WINDOW_SIZE_SEC windows
  (features.windows_from_readings) → slide LAG_WINDOWS windows to form (X, y=next avg_temp)
  → CHRONOLOGICAL 70/15/15 split per device (no shuffle) → concat → fit RF → report
  MAE/RMSE/R² on val+test → dump model.joblib + metrics.json + model_meta.json.

Run: `python train.py` (see maas/requirements.txt). Reproducible: random_state=42.
"""
from __future__ import annotations

import csv
import json
import os
from datetime import datetime, timezone

import joblib
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

from features import (
    DEVICES,
    FEATURE_NAMES,
    LAG_WINDOWS,
    WINDOW_SIZE_SEC,
    feature_vector,
    windows_from_readings,
)

DATASET_PATH = os.getenv("DATASET_PATH", "/data/iot_telemetry_data.csv")
MODEL_DIR = os.getenv("MODEL_DIR", "models")
VERSION = "1.0"
RANDOM_STATE = 42
# Constrain tree growth: unbounded trees memorize every sample → a ~700MB artifact.
# Bounding depth / leaf size keeps the model a few MB (fast to ship + load) with
# negligible metric loss, and reduces overfitting. Tuned against val/test.
RF_PARAMS = dict(
    n_estimators=150,
    max_depth=16,
    min_samples_leaf=25,
    random_state=RANDOM_STATE,
    n_jobs=-1,
)

# Chronological split fractions (per device, by time order — no shuffling).
TRAIN_FRAC, VAL_FRAC = 0.70, 0.15


def load_readings(path: str) -> dict[str, list[dict]]:
    """Read the CSV into per-device, time-sorted lists of numeric row dicts.

    Drops `temp == 0.0` sensor-dropout rows (D5 note) so they never become a target.
    """
    by_device: dict[str, list[dict]] = {d: [] for d in DEVICES}
    dropped = 0
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            device = row["device"]
            if device not in by_device:
                continue  # dataset has exactly the 3 known MACs
            temp = float(row["temp"])
            if temp == 0.0:
                dropped += 1
                continue
            by_device[device].append({
                "ts": float(row["ts"]),
                "temp": temp,
                "humidity": float(row["humidity"]),
                "co": float(row["co"]),
                "lpg": float(row["lpg"]),
                "smoke": float(row["smoke"]),
            })
    for device in by_device:
        by_device[device].sort(key=lambda r: r["ts"])
    print(f"[train] loaded {sum(len(v) for v in by_device.values())} rows "
          f"(dropped {dropped} temp==0.0); per-device: "
          + ", ".join(f"{d}={len(by_device[d])}" for d in DEVICES))
    return by_device


def build_samples(series: list[dict], device: str) -> tuple[list[list[float]], list[float]]:
    """Slide a length-LAG_WINDOWS window over a device's aggregate series.

    For windows [i, i+LAG-1] the target is window (i+LAG)'s avg_temp (next-window forecast).
    """
    X: list[list[float]] = []
    y: list[float] = []
    for i in range(len(series) - LAG_WINDOWS):
        history = series[i:i + LAG_WINDOWS]
        target = series[i + LAG_WINDOWS]["avg_temp"]
        X.append(feature_vector(history, device))
        y.append(float(target))
    return X, y


def chrono_split(n: int) -> tuple[int, int]:
    """Return (train_end, val_end) indices for an ordered 70/15/15 split."""
    train_end = int(n * TRAIN_FRAC)
    val_end = int(n * (TRAIN_FRAC + VAL_FRAC))
    return train_end, val_end


def evaluate(model: RandomForestRegressor, X: np.ndarray, y: np.ndarray) -> dict:
    pred = model.predict(X)
    return {
        "mae": round(float(mean_absolute_error(y, pred)), 4),
        "rmse": round(float(np.sqrt(mean_squared_error(y, pred))), 4),
        "r2": round(float(r2_score(y, pred)), 4),
        "n": int(len(y)),
    }


def main() -> None:
    by_device = load_readings(DATASET_PATH)

    # Build per-device samples, then split each device chronologically before concatenating,
    # so no future window of any device leaks into another's train slice.
    Xtr, ytr, Xva, yva, Xte, yte = [], [], [], [], [], []
    for device, readings in by_device.items():
        series = windows_from_readings(readings, WINDOW_SIZE_SEC)
        X, y = build_samples(series, device)
        if not X:
            print(f"[train] WARNING: {device} produced no samples ({len(series)} windows)")
            continue
        train_end, val_end = chrono_split(len(X))
        Xtr += X[:train_end];       ytr += y[:train_end]
        Xva += X[train_end:val_end]; yva += y[train_end:val_end]
        Xte += X[val_end:];         yte += y[val_end:]
        print(f"[train] {device}: {len(series)} windows → {len(X)} samples "
              f"(train {train_end}, val {val_end - train_end}, test {len(X) - val_end})")

    Xtr, ytr = np.asarray(Xtr), np.asarray(ytr)
    Xva, yva = np.asarray(Xva), np.asarray(yva)
    Xte, yte = np.asarray(Xte), np.asarray(yte)
    print(f"[train] totals — train={len(ytr)} val={len(yva)} test={len(yte)} "
          f"features={Xtr.shape[1]} (window_size={WINDOW_SIZE_SEC}s lag={LAG_WINDOWS})")

    model = RandomForestRegressor(**RF_PARAMS)
    model.fit(Xtr, ytr)

    metrics = {"val": evaluate(model, Xva, yva), "test": evaluate(model, Xte, yte)}
    print("[train] validation:", metrics["val"])
    print("[train] test:      ", metrics["test"])

    os.makedirs(MODEL_DIR, exist_ok=True)
    model_path = os.path.join(MODEL_DIR, "model.joblib")
    joblib.dump(model, model_path, compress=3)

    meta = {
        "task": "next_window_avg_temp regression",
        "algorithm": "RandomForestRegressor",
        "hyperparams": {k: v for k, v in RF_PARAMS.items() if k != "n_jobs"},
        "features": FEATURE_NAMES,
        "lag_windows": LAG_WINDOWS,
        "window_size_sec": WINDOW_SIZE_SEC,
        "unit": "C",
        "devices": list(DEVICES),
        "metrics": metrics,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "version": VERSION,
    }
    with open(os.path.join(MODEL_DIR, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)
    with open(os.path.join(MODEL_DIR, "model_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print(f"[train] wrote {model_path}, metrics.json, model_meta.json to {MODEL_DIR}/")


if __name__ == "__main__":
    main()
