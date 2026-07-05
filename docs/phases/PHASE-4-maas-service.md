# PHASE 4 — MaaS service (REST + Docker)

> Part of `IMPLEMENTATION_PLAN.md`. Read `SESSION_STATE.md` first.

## 0. Context to load first
- Read: `IMPLEMENTATION_PLAN.md` §2.4, §2.5; `docs/IoTS-3-EXPLAINED.md` §5.4; the Phase 3 doc.
- Depends on: **Phase 3 DONE** (artifact + `features.py` exist).
- Invariants: load the model **once** at startup; **no training at boot**; reuse `features.py`
  verbatim (D4); stateless (no broker, no DB).

## 1. Goal
Wrap the trained model in a small FastAPI service exposing `POST /predict`, `GET /health`,
`GET /model/info`, using the shared `features.py`, and containerize it with the artifact shipped
in the image. Add it to Docker Compose under an `ml` profile.

## 2. Entry criteria
- Phase 3 artifact (`models/model.joblib` + `model_meta.json`) available.
- `.env` has `MODEL_PATH`, `MAAS_PORT`.

## 3. Steps
1. **`maas/app.py`:**
   - At startup: `model = joblib.load(MODEL_PATH)`; load `model_meta.json`.
   - `POST /predict`: body = `{ device, history: [aggregate,…] }` (§2.4). Validate
     `len(history) == LAG_WINDOWS`; build `X = feature_vector(history, device)`;
     `yhat = float(model.predict([X])[0])`; return
     `{ prediction, target:"next_window_avg_temp", unit:"C", device, model_version }`.
   - `GET /health` → `{ "status": "ok" }`.
   - `GET /model/info` → task, algorithm, features, `lag_windows`, `window_size_sec`, metrics,
     `trained_at`, `version` (from `model_meta.json` + `metrics.json`).
   - Pydantic models for request/response ⇒ free `/docs` Swagger for the demo.
   - Optional `POST /predict/batch`.
2. **Error handling:** wrong history length or unknown device → `400` with a clear message
   (don't 500). Keep it fast (no per-request I/O beyond the model call).
3. **`maas/Dockerfile`:** `python:3.12-slim`; copy `requirements.txt` (+ `fastapi`, `uvicorn`);
   copy `features.py`, `app.py`, and `models/`; `CMD uvicorn app:app --host 0.0.0.0 --port ${MAAS_PORT}`.
4. **Compose service** (profile `ml`):
   ```yaml
     maas:
       build: ../maas
       container_name: maas
       environment:
         MODEL_PATH: "${MODEL_PATH}"
         MAAS_PORT: "${MAAS_PORT}"
       ports: ["8000:8000"]
   ```

## 4. Files created / modified
- `maas/app.py`, `maas/Dockerfile`, `maas/requirements.txt` (+ web deps)
- `docker/docker-compose.yml` (+ `maas`, profile `ml`)

## 5. Acceptance criteria (exit gate)
- [ ] `docker compose --profile ml up maas` starts; `/health` returns ok.
- [ ] `POST /predict` with a valid `LAG_WINDOWS`-length history returns a numeric `prediction` in °C.
- [ ] `/model/info` reports task/algorithm/metrics/version.
- [ ] Model is loaded once (log line at startup); no training happens at boot.
- [ ] Feature building uses `features.py` (same as `train.py`).

## 6. How to verify
```bash
docker compose --profile ml up -d maas
curl -s localhost:8000/health
curl -s localhost:8000/model/info | jq
curl -s -X POST localhost:8000/predict -H 'Content-Type: application/json' -d '{
  "device":"1c:bf:ce:15:ec:4d",
  "history":[
    {"avg_temp":25.1,"avg_humidity":42.0,"avg_co":0.0060,"max_temp":26.0},
    {"avg_temp":25.6,"avg_humidity":41.5,"avg_co":0.0064,"max_temp":26.4},
    {"avg_temp":25.9,"avg_humidity":41.1,"avg_co":0.0068,"max_temp":26.9},
    {"avg_temp":26.1,"avg_humidity":41.2,"avg_co":0.0071,"max_temp":27.4}
  ]}' | jq
```

## 7. Write back to SESSION_STATE.md
- Phase 4 → ✅ DONE; note the `/predict` contract is live and the image ships the artifact; Next → Phase 5.

## 8. Notes / gotchas
- Keep `LAG_WINDOWS` consistent with training and with the Analytics buffer (parity §2.5).
- If `/docs` is used in the demo, mention it in the README (nice, free Swagger UI).
