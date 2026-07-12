# IoTS Projekat 3 — Objašnjenje za prezentaciju

> **Predmet:** Internet stvari i servisa · **Projekat:** 3
> **Autor:** Bogdan (bxgda) · **Repo:** `iots-3`
> **Sve na jednu komandu:** `docker compose -f docker/docker-compose.yml --profile mqtt --profile app --profile cep --profile ml --profile web up -d`

---

## 1. Šta radi projekat (u dva minuta)

Projekat 3 nadograđuje **Analytics mikroservis** iz Projekta 2 tako da **analitiku više ne
radi ručno** nego je delegira na dva specijalizovana servisa:

- **eKuiper** — streaming/CEP engine sa deklarativnim SQL pravilima koja se izvršavaju nad
  tokom senzora (`sensors/telemetry`) i emituju detektovane događaje na novi topic
  (`sensors/events`);
- **MaaS** (Model-as-a-Service) — REST servis koji servira **istrenirani Random Forest**
  model za predikciju sledeće prosečne temperature po uređaju.

**Analytics je sada tanak orkestrator**: preuzima događaje od eKuiper-a, za događaje od
interesa zove `POST /predict` na MaaS-u, i emituje **obogaćeni predictive alert** — sirov CEP
događaj + numerička predikcija sledećeg prozora. Web aplikacija u realnom vremenu prikazuje
sve to preko **Socket.IO**.

**Sve je MQTT-only** (Mosquitto broker) i sve se pokreće kao **Docker kontejneri** kroz
`docker compose` sa profilima (`mqtt`, `app`, `cep`, `ml`, `web`).

---

## 2. Poklapanje sa profesorovim zadatkom (tačka po tačka)

| Zahtev iz zadatka | Gde je u projektu | Status |
|-------------------|-------------------|--------|
| **1a.** Analytics koristi eKuiper CEP preko MQTT | `services/analytics-service/app/*` sluša `sensors/events`; eKuiper `docker/docker-compose.yml` pod `cep` profilom | ✅ |
| **1b.** Analytics koristi MaaS REST endpoint | `services/analytics-service/app/maas_client.py`, `events.py` (POST /predict + timeout + CEP-only fallback) | ✅ |
| **2.** eKuiper pretplaćen na isti topic (`sensors/telemetry`) kao P2 Analytics, primenjuje pravila, šalje događaje na novi topic (`sensors/events`) | `ekuiper/streams/sensor_stream.json`, 4 pravila u `ekuiper/rules/` provisionovana **preko REST API** kroz `ekuiper/provision.sh` (bez UI klikova) | ✅ |
| **3.** MaaS = Python + FastAPI + scikit-learn (regresija na vremenskoj seriji senzora) | `maas/app.py` (FastAPI), `maas/train.py` + `features.py` (scikit-learn RandomForestRegressor, chrono 70/15/15 split, MAE/RMSE/R² na test setu) | ✅ |
| **4.** Docker kontejneri + Web aplikacija | 9 servisa u `docker-compose.yml`; React+Vite+Tailwind+Socket.IO web app u `webapp/` (kontejner + nginx serve) | ✅ |
| **5.** GitHub + opis mikroservisa | Kompletan opis niže; poseban paragraf po servisu | ✅ |

---

## 3. Arhitektura

```
      Ingestion  ─pub─► sensors/telemetry ─►  Mosquitto (MQTT)  ─┬─► Storage ─► TimescaleDB
                              (dataset replay)                    │              (hipertabela)
                                                                  │
                                                                  └─► eKuiper (CEP + streaming)
                                                                        • sensor_stream (schema)
                                                                        • WINDOW_METRICS (rollup, 10s)
                                                                        • HIGH_CO (per-message)
                                                                        • SUSTAINED_HIGH_TEMP (HAVING)
                                                                        • HEAT_DRYING (višeuslovna korelacija)
                                                                        └─pub─► sensors/events
                                                                                    │
                                                                                    ▼
                                          Analytics (FastAPI, orkestrator)
                                            • rutira po event_type
                                            • buffer poslednja LAG_WINDOWS=4 rollup-a po uređaju
                                            • na svaki event-of-interest → POST /predict → MaaS
                                            • formira [PREDICTIVE ALERT] (actual + forecast + model_version)
                                            • timeout 1000ms + CEP-only fallback (nikad ne blokira)
                                            └─► Socket.IO event/alert kanali + REST /api/*
                                                            │
                                                            ▼
                                                Web app (React+Vite+Tailwind)
                                                • live event feed
                                                • predictive alert kartice
                                                • predicted-vs-actual chart (recharts)
```

Web aplikacija priča isključivo sa **Analytics** servisom (Socket.IO za live, REST za
snapshot-e) — **browser nikad ne priča sa MQTT brokerom** (dizajn odluka D11 iz
implementacionog plana).

---

## 4. Mikroservisi (kratak opis svakog)

### 4.1 **Ingestion Service** (NestJS, TypeScript)
Simulator uređaja i **jedini publisher** sirove telemetrije. Reprodukuje realan
Kaggle dataset (Environmental Sensor Telemetry Data, ~405k redova, 3 stvarna MAC-a
fanout-uju se na `NUM_DEVICES=100` simuliranih uređaja kroz `-N` sufiks), stampa svaki
paket sa `seq` brojačem i `sent_at_ms` timestamp-om, i publikuje na `sensors/telemetry`
sa `MESSAGES_PER_SECOND=10` po uređaju (1000 msg/s ukupno). **Reused iz Projekta 2**.
Control endpoints: `/health`, `/stats`, `POST /burst?durationSec=N`.

### 4.2 **Storage Service** (NestJS, TypeORM, TimescaleDB)
**Jedini pisač u bazu**. Pretplaćen na `sensors/telemetry`, prati `seq` integritet (gaps
= gubitak, repeats = duplikat), piše u TimescaleDB hipertabelu (`ON CONFLICT DO NOTHING`
za idempotenciju). Podržava dva režima (`WRITE_MODE=BATCH`/`DIRECT`). **Reused iz Projekta 2**.
Merenje transport latencije: `received_at_ms - sent_at_ms`.

### 4.3 **eKuiper** (LF Edge eKuiper 2.2.1-slim, novo u P3)
Streaming/CEP engine. Ne uređujemo pravila kroz UI — sve se **reproducibilno provisionuje
kroz REST API** iz `ekuiper/provision.sh` (idempotentna DELETE-then-POST logika, izvršava
se kao one-shot compose job). Definisan **jedan stream** (`sensor_stream` sa tipiziranom
šemom nad `sensors/telemetry`) i **4 pravila**:

| Rule | Vrsta | SQL osnova | Šta detektuje |
|------|-------|-----------|----------------|
| `window_metrics` | agregatni rollup (bez HAVING) | `AVG/MAX/MIN … GROUP BY device, TUMBLINGWINDOW(ss,10)` | prosek po uređaju svaki prozor — hrani forecast buffer i chart |
| `high_co` | per-message threshold | `WHERE co > CO_HIGH` | CO iznad granice odmah |
| `sustained_high_temp` | **windowed HAVING** | `HAVING AVG(temp) > SUSTAINED_TEMP` | prosek temperature u prozoru iznad 25°C |
| `heat_drying` | **višeuslovna korelacija** | `HAVING AVG(temp) > TEMP_HIGH AND AVG(humidity) < HUMIDITY_LOW` | topao i suv prozor istovremeno |

**Prozor je env-templated** (`WINDOW_TYPE`, `WINDOW_UNIT`, `WINDOW_SIZE`, `WINDOW_STEP`)
— tumbling se može zameniti sliding-om samo promenom `.env`, bez menjanja SQL-a.

Sink: MQTT publish na `sensors/events` sa `sendSingle: true`.

### 4.4 **MaaS — Model-as-a-Service** (Python 3.12, FastAPI, scikit-learn, novo u P3)
REST wrapper oko istreniranog Random Forest regresora.

**Zadatak** (D1): predikcija `avg_temp` sledećeg 10-sekundnog prozora po uređaju.
**Model** (D2): `RandomForestRegressor(n_estimators=150, max_depth=16, min_samples_leaf=25)`;
14 MB artifact (bounding + `compress=3`; slobodni RF je bio 737 MB **i** overfit-ovan).
**Feature vektor** (19 komponenti): 4-lag `avg_temp` / `avg_humidity` / `avg_co`, latest
`max_temp`, rolling mean/std i trend `avg_temp`-a, i one-hot 3 pravih uređaja.
**Metrike na test setu**: **MAE = 0.073 °C · RMSE = 0.420 · R² = 0.988** (val R² = 0.985).

**Trening** (`train.py`) je offline i deterministički (`random_state=42`); učitava CSV bez
pandas-a (stdlib `csv`), izbacuje 7 dropout redova (`temp==0`), radi per-device chronological
70/15/15 split pa concat, fituje, i piše `models/{model.joblib, metrics.json, model_meta.json}`.

**Servis** (`app.py`) — jedini `feature_vector` je onaj iz `features.py` koji se **doslovno**
importuje i u treningu i u servisu (D4: bez train/serve skew, #1 MaaS bug). Startup lifecycle
učitava model **jednom** i radi parity guard (`n_features_in_ vs len(FEATURE_NAMES)` i
`meta.lag_windows vs env.LAG_WINDOWS`), pa fail-fast ako neko nesvesno rasforma feature set.

Endpointi (svi Pydantic-validisani, slobodan Swagger UI na `/docs`):

- `GET /health` → `{"status":"ok"}`
- `GET /model/info` → task/algorithm/features/metrics/version (iz `model_meta.json`)
- `POST /predict` → `{prediction, target:"next_window_avg_temp", unit:"C", device, model_version}`

Validacija: neispravan `history` length ili nepoznat uređaj → **HTTP 400** (nikad 500).
`base_device()` skida `-N` sufiks pa training (bare MAC) i serving (`MAC-N`) dele isti
one-hot.

**Artifact ships in the image** (`Dockerfile COPY models/…` u `/models/`) — Phase-4
acceptance: bez treninga na boot-u.

### 4.5 **Analytics Service** (Python 3.12, FastAPI + aiomqtt + httpx + python-socketio, **modified** u P3)
Bio je "tumbling window + threshold alert" u P2; sada je **tanak orkestrator**:

1. **Subscribe** na `sensors/events` preko MQTT (broker adapter iz `libs/broker` — nested
   apstrakcija koja se preselekcija iz `BROKER_TYPE` env-a, sada MQTT-only ali kod je spreman
   da se ponovo doda drugi broker bez menjanja business logike);
2. **Rutira** po `event_type`: `WINDOW_METRICS` se pumpa u per-device ring buffer
   (`deque(maxlen=LAG_WINDOWS=4)`) — to je "history" koja se šalje MaaS-u;
3. **Za svaki event-of-interest** (`HIGH_CO`, `SUSTAINED_HIGH_TEMP`, `HEAT_DRYING`, …):
   ako je buffer pun 4/4, `POST /predict` na MaaS sa hardcoded 1000ms timeout-om (u
   `httpx.AsyncClient`); pa formira enriched alert (§message-contract Enriched alert) sa
   actual `avg_temp` iz eKuiper događaja + `forecast_next_avg_temp` iz MaaS-a + `model_version`;
4. **Fallback (must-have)**: bilo koji failure (timeout, HTTPError, connection error) — subscribe
   loop **nastavlja**, alert se ipak emituje sa `forecast_available:false` i porukom "prediction
   unavailable"; MaaS gore ≠ pipeline pada;
5. **Emit ka web-u**: `python-socketio` server je ASGI-mount-ovan oko FastAPI-ja pa isti port
   (`3003`) servira REST + `/socket.io`. Dve kanala: `event` (svaki `sensors/events` message
   se relay-uje verbatim → hrani chart) i `alert` (enriched alert → hrani predictive alert feed).
6. **REST snapshots** za web app first-load: `/api/events`, `/api/alerts`, `/api/forecast/{device}`,
   `/api/devices` (in-memory ring buffer-i, cap 200).
7. **Log**: `[PREDICTIVE ALERT] device=… eKuiper=HIGH_CO (avg 26.1°C) | MaaS=next 26.9°C | pre-emptive`
   ili `... | MaaS=unavailable (prediction unavailable)`.

Control endpoints: `/health`, `/stats` (broker cfg + event counter po tipu + buffer depth po
uređaju + Socket.IO ring buffer metrike).

### 4.6 **Web app** (React + Vite + TypeScript + Tailwind CSS + TanStack Query + axios + socket.io-client + Recharts, novo u P3)
Fokusiran dashboard koji vizuelizuje **kompletan novi pipeline**:

- **Live** preko Socket.IO (dva kanala): `event` puni event feed i actual liniju na chart-u,
  `alert` puni predictive alert kartice i forecast tačke;
- **Initial load** preko TanStack Query + axios: `/api/events`, `/api/alerts`, `/api/forecast/:device`,
  `/api/devices` — dashboard izgleda "živo" na first paint umesto praznog stanja;
- **Predicted-vs-actual temp chart** (Recharts) — bela linija = actual `avg_temp` (iz WINDOW_METRICS),
  plava isprekidana = `forecast_next_avg_temp` (iz alert-a). Money shot demo-a.
- Non-blocking (D10): kontejner je pod `web` profilom, ništa u pipeline-u `depends_on` webapp;
  ako se gasi, sve i dalje radi.

Runtime: **multi-stage Docker build** — Node builder → nginx-alpine serving statičkog build-a;
`VITE_API_URL` se **bake-uje na build time** (compose `args: { VITE_API_URL: ... }`) tako da
je runtime iz nginx-a bez ijedne Node dependency.

---

## 5. Kako pokrenuti

**Fresh clone od nule** (5 koraka):

```bash
# 1. Dataset (gitignored, ~62 MB) — postavi u data/
#    data/iot_telemetry_data.csv
# 2. .env
cp docker/.env.example docker/.env
# 3. (Jednom, iz maas/) — trening modela; artifact se sprema u maas/models/
docker run --rm -v "$PWD/maas:/maas" -v "$PWD/data:/data" -w /maas \
  python:3.12-slim bash -c "pip install -q -r requirements.txt && python train.py"
# 4. Podigni ceo stack jednom komandom (svi profili):
docker compose -f docker/docker-compose.yml \
  --profile mqtt --profile app --profile cep --profile ml --profile web up -d
# 5. Otvori u browseru
open http://localhost:8080     # web app dashboard (Chrome/Firefox/Edge)
open http://localhost:8000/docs # MaaS Swagger UI (test /predict ručno)
```

**Verifikacija E2E** (dok stack radi):

```bash
# Analytics /stats — buffer depth + eventsByType
curl -s localhost:3003/stats | python -m json.tool

# MaaS model card
curl -s localhost:8000/model/info | python -m json.tool

# Alertovi u realnom vremenu
docker logs -f iots-analytics | grep "PREDICTIVE ALERT"

# Sirovi eKuiper eventi
docker exec iots-mosquitto mosquitto_sub -t 'sensors/events' -v

# Web app snapshot
curl -s "localhost:3003/api/alerts?limit=5" | python -m json.tool

# Predict ručno (poziv koji Analytics interno pravi)
curl -X POST localhost:8000/predict -H 'Content-Type: application/json' -d '{
  "device":"1c:bf:ce:15:ec:4d",
  "history":[
    {"avg_temp":25.1,"avg_humidity":42.0,"avg_co":0.006,"max_temp":26.0},
    {"avg_temp":25.6,"avg_humidity":41.5,"avg_co":0.0064,"max_temp":26.4},
    {"avg_temp":25.9,"avg_humidity":41.1,"avg_co":0.0068,"max_temp":26.9},
    {"avg_temp":26.1,"avg_humidity":41.2,"avg_co":0.0071,"max_temp":27.4}
  ]}' | python -m json.tool
```

---

## 6. Konvencije koje ne treba menjati nesvesno (parity invariants)

- `WINDOW_SIZE=10s` — mora se poklapati između eKuiper provision-a i `train.py` windowing-a.
  Promena → **retrain**.
- `LAG_WINDOWS=4` — mora se poklapati u `train.py`, MaaS `features.py`, Analytics buffer depth.
- Jedinica temperature: **°C end-to-end** (dataset je već u °C, potvrđeno u Phase 0 verifikaciji).
- `RAW_TOPIC=sensors/telemetry` — nikad ne preimenovati; `sensors/events` je eKuiper sink;
  browser ide **preko Analytics-a**, ne preko MQTT-a.
- MaaS `feature_vector` = **doslovno isti kod** u `train.py` i u `app.py` (D4: shared
  `features.py`) — nikakvo paralelno "feature engineering" u Analytics-u.

---

## 7. Šta reći na odbrani (elevator pitch)

> „P2 je imao Analytics koji je ručno pravio prozore i vukao thresholde. U P3 taj deo je izvučen
> u dva specijalizovana servisa: **eKuiper** koji preko deklarativnog SQL-a preko streaming
> engine-a detektuje događaje od interesa (rollup + 3 CEP pravila, uključujući windowed HAVING
> i višeuslovnu korelaciju), i **MaaS** kao Python FastAPI REST servis koji servira
> istreniran Random Forest za predikciju sledećeg prosečnog temperaturnog prozora (R²=0.988,
> MAE=0.073°C na test setu).
>
> **Analytics je sada tanak orkestrator** — sluša događaje od eKuiper-a, za svaki događaj od
> interesa zove `POST /predict`, kombinuje CEP detekciju sa ML predikcijom u obogaćeni
> `[PREDICTIVE ALERT]`, i **push-uje sve u web app preko Socket.IO**. React + Vite + Tailwind
> dashboard prikazuje event feed, alert kartice i predicted-vs-actual chart.
>
> Sve u Dockeru, jedna komanda podiže ceo pipeline (5 profila), MaaS je **rezilijentan** (1s
> timeout + CEP-only fallback), rules se provisionuju **preko REST-a a ne UI-a** (svež klon =
> radan sistem, zero clicks), i **feature transform je jedinstven** (D4 — train/serve skew, koji
> je #1 MaaS bug, je izbegnut kroz doslovan import istog `features.py`)."

---

## 8. Dokumentacioni tragovi (za dublje pitanje)

| Ako te pitaju o… | Otvori |
|-------------------|--------|
| šta i zašto | [docs/REQUIREMENTS-IoTS-3.md](docs/REQUIREMENTS-IoTS-3.md), [docs/IoTS-3-EXPLAINED.md](docs/IoTS-3-EXPLAINED.md) |
| plan implementacije po fazama | [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md), `docs/phases/PHASE-0..8` |
| šta je bilo urađeno kada | [CLAUDE.md](CLAUDE.md) (dnevni change log), [SESSION_STATE.md](SESSION_STATE.md) |
| payload format i topic-e | [shared/message-contract.md](shared/message-contract.md) |
| threshold-i (°C-kalibrisani) | [shared/thresholds.md](shared/thresholds.md) |
| dataset schema | [shared/dataset_info.md](shared/dataset_info.md) |
| MaaS specifika | [maas/README.md](maas/README.md) |
| eKuiper provisioning | [ekuiper/README.md](ekuiper/README.md) |
