# PHASE 3 — MaaS offline training

> Part of `IMPLEMENTATION_PLAN.md`. Read `SESSION_STATE.md` first.
> **Parallelizable:** depends only on Phase 0, so it can run alongside Phases 1–2.

## 0. Context to load first
- Read: `IMPLEMENTATION_PLAN.md` §0 (D1–D5), §2.4, §2.5, §3; `docs/IoTS-3-EXPLAINED.md` §5.
- Depends on: **Phase 0 DONE** (unit confirmed; contracts agreed).
- Invariants: window **size** used to build training aggregates = eKuiper `WINDOW_SIZE`
  (default 10s); `LAG_WINDOWS` = the buffer depth used at serve time; the feature transform must
  live in **one** shared module reused by the service (D4).

## 1. Goal
Produce a reproducible `train.py` that turns `iot_telemetry_data.csv` into a supervised
regression dataset (predict next-window `avg_temp` per device), trains a `RandomForestRegressor`
with a **chronological** train/val/test split, reports MAE/RMSE/R², and serializes the artifact.
The feature-building logic goes into `maas/features.py` so the service (Phase 4) reuses it
verbatim.

## 2. Entry criteria
- Phase 0 acceptance passed; `data/iot_telemetry_data.csv` present (gitignored).
- Wire unit recorded (Celsius expected; if °F, add the same conversion here).

## 3. Steps
1. **`maas/features.py` — the shared transform.** Two pure functions:
   - `windows_from_readings(df, window_size_sec) -> list[dict]`: per device, bucket rows into
     non-overlapping windows and compute `avg_temp, max_temp, min_temp, avg_humidity, avg_co,
     avg_lpg, avg_smoke, sample_count, window_start, window_end`. (Same aggregates as the eKuiper
     rollup, §2.2.) Used only in training to synthesize the aggregate stream.
   - `feature_vector(history: list[dict], device: str) -> list[float]`: from the last
     `LAG_WINDOWS` aggregate dicts build the flat model input — lagged `avg_temp`,
     `avg_humidity`, `avg_co`; latest `max_temp`; rolling mean/std of `avg_temp`; trend
     `avg_temp[-1]-avg_temp[0]`; `device` one-hot (3 devices). **This is the function the service
     calls too.**
2. **`maas/train.py`:**
   - Load CSV; sort by `device`, `ts`. **Drop `temp==0.0` dropout rows** (D5 note).
   - Build the per-device window aggregate series via `windows_from_readings`.
   - For each device, slide a length-`LAG_WINDOWS` window over its aggregate series → `X` via
     `feature_vector`; `y` = next window's `avg_temp`.
   - **Chronological split** per device (e.g. 70/15/15 by time; no shuffling — `TimeSeriesSplit`
     or ordered slice). Concatenate devices.
   - Train `RandomForestRegressor` (sane defaults; `n_estimators≈200`, `random_state=42`).
   - Evaluate on val **and** test: report **MAE, RMSE, R²**; print + save to `models/metrics.json`.
   - `joblib.dump(model, MODEL_PATH)`; also persist a small `models/model_meta.json`
     (`window_size_sec`, `lag_windows`, `feature_names`, `trained_at`, `version="1.0"`).
3. **Sanity notebook/step (optional):** plot predicted vs actual on the test slice for one device.
4. **Requirements:** `maas/requirements.txt` = `scikit-learn`, `pandas`, `numpy`, `joblib`
   (+ `fastapi`, `uvicorn` added in Phase 4).

## 4. Files created / modified
- `maas/features.py`, `maas/train.py`, `maas/requirements.txt`
- outputs: `maas/models/model.joblib`, `maas/models/metrics.json`, `maas/models/model_meta.json`
  (artifacts gitignored or committed per repo policy; the image ships the artifact — D-invariant)

## 5. Acceptance criteria (exit gate)
- [ ] `python maas/train.py` runs start-to-finish and writes the artifact + metrics.
- [ ] Split is **chronological** (no shuffle) with train/val/test all reported.
- [ ] Metrics printed and saved: MAE, RMSE, R² on val and test.
- [ ] `feature_vector` is the **only** feature-building path (no duplicate logic elsewhere).
- [ ] `temp==0.0` rows excluded from targets.

## 6. How to verify
```bash
cd maas && pip install -r requirements.txt
python train.py                      # expect metrics printed; models/ populated
cat models/metrics.json              # MAE/RMSE/R² present for val + test
python -c "import joblib; print(joblib.load('models/model.joblib'))"
```

## 7. Write back to SESSION_STATE.md
- Phase 3 → ✅ DONE; record final metrics (MAE/RMSE/R²), `WINDOW_SIZE`/`LAG_WINDOWS` used,
  and model version; Next → Phase 4.

## 8. Notes / gotchas
- **Train/serve skew is the #1 bug:** never build features anywhere but `features.py`.
- If `WINDOW_SIZE` changes later, this must be retrained (parity invariant §2.5).
- Keep it sklearn-simple first; only try an LSTM if the core is already green and time allows.
