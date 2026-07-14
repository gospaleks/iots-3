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
| **4.** Docker kontejneri + Web aplikacija | 9 servisa u `docker-compose.yml`; React + shadcn/ui + Socket.IO web app u `webapp/` (kontejner + nginx serve) | ✅ |
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
                                                Web app (React + shadcn/ui)
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
Kaggle dataset (Environmental Sensor Telemetry Data, ~405k redova, 3 stvarna MAC-a),
stampa svaki paket sa `seq` brojačem i `sent_at_ms` timestamp-om, i publikuje na
`sensors/telemetry`. **Reused iz Projekta 2**.
Control endpoints: `/health`, `/stats`, `POST /burst?durationSec=N`.

**Demo podešavanje:** `NUM_DEVICES=3` × `MESSAGES_PER_SECOND=10` = 30 msg/s (≈100 uzoraka po
10s window-u — dovoljno za smislene agregate, a event feed ostaje čitljiv). Sa 3 uređaja svaki
dobija **čist MAC bez `-N` sufiksa** (fanout se uključuje tek za `NUM_DEVICES > 3`), pa se na
frontend-u vide tačno 3 uređaja = 3 profila iz dataset-a. Za demo skaliranja podigni
`NUM_DEVICES` (npr. 100) — id-evi tada postaju `<mac>-<i>`.

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

### 4.6 **Web app** (React 19 + Vite + TypeScript + **shadcn/ui** (Base UI, Tailwind v4) + socket.io-client + Recharts, novo u P3)
Fokusiran dashboard koji vizuelizuje **kompletan novi pipeline**:

- **Live** preko Socket.IO (dva kanala): `event` puni event stream i actual liniju na chart-u,
  `alert` puni predictive alert kartice i forecast tačke;
- **Initial load** preko REST snapshot ruta (`/api/events`, `/api/alerts`, `/api/devices`) —
  dashboard izgleda "živo" na first paint umesto praznog stanja;
- **Actual-vs-forecast temp chart** (Recharts kroz shadcn `Chart`) — puna linija = actual
  `avg_temp` (iz WINDOW_METRICS), isprekidana + tačke = `forecast_next_avg_temp` (iz alert-a).
  Money shot demo-a.
- **Otporan na burst-ove i na promenu window-a** (v2): socket poruke se pufuju u `ref`-u i
  flush-uju se u state na interval (jedan render po flush-u, bez obzira na dolaznu brzinu),
  a chart crta obe serije na **numeričkoj vremenskoj osi** sa bucket-om od 1s — pa radi i za
  `tumbling` i za `hopping`, i preživi `sliding` flood.
- Non-blocking (D10): kontejner je pod `web` profilom, ništa u pipeline-u `depends_on` webapp;
  ako se gasi, sve i dalje radi.

Runtime: **multi-stage Docker build** — Node builder (`npm ci`, lockfile je komitovan) →
nginx-alpine serving statičkog build-a; `VITE_API_URL` se **bake-uje na build time**
(compose `args: { VITE_API_URL: ... }`) tako da je runtime iz nginx-a bez ijedne Node dependency.

> UI je pisan po dva skill-a iz `.agents/skills/`: **shadcn** (komponente se dodaju CLI-jem,
> koriste se isključivo semantički tokeni — nikad sirovi hex) i **frontend-design**.
> Kako se čita ekran → sekcija [5c](#5c-kako-se-čita-dashboard-šta-koji-element-znači).

---

## 5. Kako pokrenuti — korak po korak (Windows + Docker Desktop)

**Preduslovi na mašini:**
- Windows 10/11 sa **Docker Desktop** (Linux containers, sa WSL2 backend-om) — daemon mora biti startovan (whale ikonica u system tray zelena)
- **Git** za klon
- Terminal (PowerShell ili Git Bash)
- (Opciono) Chrome/Firefox/Edge za dashboard

### 5.1 Klon i priprema (jednom po mašini)

```powershell
git clone https://github.com/gospaleks/iots-3.git
cd iots-3

# 1) Dataset (gitignored, ~62 MB). Preuzmi Environmental Sensor Telemetry Data
#    (Kaggle: garystafford/environmental-sensor-data-132k) i snimi kao:
#    data\iot_telemetry_data.csv
#    Prvi red mora biti: "ts","device","co","humidity","light","lpg","motion","smoke","temp"

# 2) Env fajl:
Copy-Item docker\.env.example docker\.env

# 3) Trening modela (jednom — pravi maas\models\model.joblib, ~14 MB).
#    Traje ~30–60s na Docker Desktop. Ne treba ti sklearn na hostu.
docker run --rm `
  -v "${PWD}\maas:/maas" `
  -v "${PWD}\data:/data" `
  -w /maas `
  python:3.12-slim bash -c "pip install -q -r requirements.txt && python train.py"
```

Očekivan izlaz treninga (poslednja 3 reda):
```
[train] validation: {'mae': 0.058, 'rmse': 0.369, 'r2': 0.985, 'n': 30186}
[train] test:       {'mae': 0.073, 'rmse': 0.420, 'r2': 0.988, 'n': 30187}
[train] wrote models/model.joblib, metrics.json, model_meta.json to models/
```

### 5.2 Pun stack — jedna komanda

```powershell
docker compose -f docker/docker-compose.yml `
  --profile mqtt --profile app --profile cep --profile ml --profile web up -d
```

Šta se startuje (9 kontejnera):

| Kontejner | Port | Uloga |
|-----------|------|-------|
| `iots-timescaledb` | 5432 | baza (hipertabela) |
| `iots-mosquitto` | 1883 | MQTT broker |
| `iots-ingestion` | 3001 | simulator uređaja (publisher) |
| `iots-storage` | 3002 | subscriber → TimescaleDB writer |
| `iots-analytics` | 3003 | orkestrator + Socket.IO + REST /api/* |
| `iots-ekuiper` | 9081 | CEP engine (REST management) |
| `iots-ekuiper-provision` | — | one-shot: postavlja stream + 4 pravila i izlazi |
| `iots-maas` | 8000 | FastAPI + RandomForest (/predict, /docs) |
| `iots-webapp` | 8080 | React dashboard |

Prvi start je ~30–60s (build image-a). Sledeći put — sekunde, jer se image-i keš-iraju.

### 5.3 Otvori u browser-u

- **Dashboard:** http://localhost:8080
- **MaaS Swagger** (za ručno testiranje `/predict`): http://localhost:8000/docs

### 5.4 Ugasi kad završiš

```powershell
docker compose -f docker/docker-compose.yml `
  --profile mqtt --profile app --profile cep --profile ml --profile web down
```

Dodaj `-v` na kraj ako želiš i da obrišeš volumes (TimescaleDB podatke, Mosquitto retention).

---

## 5b. Kako da sam proveriš da sve radi (checklist)

Nakon što je `up -d` završio, sačekaj **~30s** da se buffer napuni (eKuiper prozor je 10s, treba 4
prozora × 10s = **40s** za pun feature vektor), pa proveri redom:

### ✅ 1) Svi kontejneri gore (i nijedan ne restartuje)

```powershell
docker ps --format "table {{.Names}}\t{{.Status}}"
```

Trebalo bi da vidiš 8 `Up …` linija (9. `iots-ekuiper-provision` je one-shot i posle uspešnog
provisioning-a izlazi sa exit 0 — to je normalno; ne pojavljuje se u `docker ps` posle par sekundi).
`Restarting` znači problem — pogledaj `docker logs <ime>`.

### ✅ 2) MaaS health + model card

```powershell
curl http://localhost:8000/health
curl http://localhost:8000/model/info
```

Očekuješ:
- `/health` → `{"status":"ok"}`
- `/model/info` → JSON sa `task=next_window_avg_temp regression`, `algorithm=RandomForestRegressor`,
  `metrics.test.r2 ≈ 0.988`, `mae ≈ 0.073`, `version=1.0`

### ✅ 3) eKuiper 4 pravila u statusu `running`

```powershell
curl http://localhost:9081/rules
```

Traži svih 4: **`window_metrics`**, **`high_co`**, **`sustained_high_temp`**, **`heat_drying`** —
svako sa `"status":"running"`. Ako neko nedostaje ili je `stopped`, zapušio se provisioner — pogledaj
`docker logs iots-ekuiper-provision`.

### ✅ 4) Analytics prima događaje i puni buffer

```powershell
curl http://localhost:3003/stats
```

Traži:
- `eventsByType` treba da sadrži `WINDOW_METRICS` (posle par sekundi), pa `SUSTAINED_HIGH_TEMP`
  (samo za `1c:bf:ce:15:ec:4d`, avg_temp ~26.9°C > 25) i `HEAT_DRYING` (samo za
  `b8:27:eb:bf:9d:51`, toplo **i** suvo). `HIGH_CO` dolazi povremeno, u naletima.
- `bufferDepthByDevice` — vrednost 4 (pun buffer) za sva 3 uređaja posle ~40s

### ✅ 5) [PREDICTIVE ALERT] linije u Analytics log-u (**najvažnija provera**)

```powershell
docker logs --tail=100 iots-analytics | Select-String "PREDICTIVE ALERT"
```

Očekivan format (jedna od ovih varijanti — stvaran output sa 3-device demo podešavanja):
```
[PREDICTIVE ALERT] device=1c:bf:ce:15:ec:4d eKuiper=SUSTAINED_HIGH_TEMP (avg 26.9°C) | MaaS=next 27.1°C | pre-emptive
[PREDICTIVE ALERT] device=b8:27:eb:bf:9d:51 eKuiper=HEAT_DRYING (avg 22.3°C) | MaaS=next 22.2°C | pre-emptive
```

Vidiš `| MaaS=next X.X°C | pre-emptive` → **ML predikcija radi**.
Vidiš `| MaaS=unavailable (buffer not full yet)` — sačekaj još 10-20s da se buffer napuni.

### ✅ 6) Sirovi eKuiper events (dokaz da CEP pravilo emituje na `sensors/events`)

```powershell
docker exec iots-mosquitto mosquitto_sub -t "sensors/events" -C 5
```

`-C 5` = izađi posle 5 poruka. Vidiš JSON objekte sa `event_type`, `device`, `avg_temp`, itd.

### ✅ 7) REST snapshot rute (dokaz da Analytics puni ring buffer)

```powershell
curl "http://localhost:3003/api/alerts?limit=3"
curl "http://localhost:3003/api/events?limit=3"
curl "http://localhost:3003/api/devices"
```

Prvi vraća niz enriched alertova sa `forecast_next_avg_temp` i `message`. Treći listu device
id-eva (sa demo podešavanjem: 3 čista MAC-a).

### ✅ 8) Web dashboard — http://localhost:8080

Otvori u browser-u. Trebalo bi da vidiš (detaljno objašnjenje svakog elementa → **sekcija 5c**):

- **U zaglavlju desno:** badge `Live` (zelen), `3 devices`, i `window tumbling · 10s`.
- **Pipeline rail** (ispod zaglavlja): 4 faze sa živim brojačima — Ingestion `~30/s`,
  eKuiper CEP, MaaS forecast, Alerts.
- **Temperature forecast** (glavni panel): puna linija = actual, isprekidana + tačke = forecast.
  U dropdown-u izaberi **Highly variable** (`1c:bf:ce:15:ec:4d`) — taj uređaj ima najviše alertova.
- **Event stream** (dole-levo): legenda 4 tipa + rolling tabela. Dugme **"Events only"** sakriva
  `WINDOW_METRICS` da ostanu samo zanimljivi događaji.
- **Predictive alerts** (dole-desno): kartice `now XX.X°C → next XX.X°C` + delta badge +
  `forecast v1.0`.

### ✅ 9) MaaS Swagger — ručan test predikcije

Otvori http://localhost:8000/docs → `POST /predict` → "Try it out" → Execute sa default body-jem.
Očekuješ `HTTP 200` i `{"prediction": ~26.7, "target": "next_window_avg_temp", "unit": "C", ...}`.
Ako promeniš `history` da ima 3 elementa umesto 4 → **HTTP 400** sa jasnim error message-om (to je
namerno — dokaz da validation radi).

### ✅ 10) Fallback test — ubi MaaS, pipeline ne pada

```powershell
docker stop iots-maas
Start-Sleep -Seconds 15
docker logs --tail=30 iots-analytics | Select-String "prediction unavailable"
```

Očekuješ `[PREDICTIVE ALERT] ... | MaaS=unavailable (prediction unavailable)` linije. Bez
`iots-analytics` restart-a, bez hang-a. Vrati MaaS: `docker start iots-maas`, sačekaj 3s, i alerti
opet imaju `MaaS=next X.X°C`.

---

## 5c. Kako se čita dashboard (šta koji element znači)

> Ovo je "priručnik za ekran" — pročitaj pre odbrane. Cilj dashboard-a je da se **ceo pipeline
> vidi na jednom ekranu**: sirovi podaci → eKuiper detekcija → MaaS predikcija → alert.

### Zaglavlje (gore)

| Element | Značenje |
|---|---|
| `Live` (zeleno) / `Offline` (crveno) | Socket.IO konekcija ka Analytics-u. Ako je `Offline`, Analytics je pao ili je CORS pogrešan — podaci na ekranu su tada stari. |
| `3 devices` | Koliko različitih uređaja je viđeno u stream-u. Sa `NUM_DEVICES=3` očekuješ 3. |
| `window tumbling · 10s` | **Koji eKuiper window je aktivan** — app ovo *ne čita iz konfiguracije*, nego **zaključuje iz samih podataka**: širina = `window_end − window_start`, korak = razmak između uzastopnih `window_start`. Ako prebaciš na hopping, badge sam postane `window hopping · 10s / 5s`. Dobar "gotcha" odgovor ako te pitaju kako znaš da je promena stvarno primenjena. |

### Pipeline rail (traka sa 4 faze) — *signature* element

Čita se **s leva na desno = tok podataka**:

1. **Ingestion** `~30/s` — brzina dolaska događaja (mereno u browseru, poslednjih 5s).
2. **eKuiper CEP** — ukupno detektovanih događaja od otvaranja stranice.
3. **MaaS forecast** — koliko je alertova **stvarno dobilo predikciju** (uspešan `/predict`).
4. **Alerts** — ukupno enriched alertova.

> Ako **MaaS forecast** stoji na 0 a **Alerts** raste → MaaS je pao ili buffer još nije pun
> (treba 4 window-a ≈ 40s). To je tačno fallback scenario iz provere ✅10.

### Badge-evi tipova događaja (legenda u "Event stream")

Boja = **ozbiljnost**, i namerno su samo 3 nivoa (koriste se semantički tokeni, ne sirove boje):

| Badge | Tip | Šta znači | Koji uređaj ga pali |
|---|---|---|---|
| **Window metrics** (sivo, `secondary`) | `WINDOW_METRICS` | Rutinski 10-sekundni rollup — emituje se za **svaki** window, za svaki uređaj. To je "puls" sistema, ne alarm. | sva 3 |
| **High CO** (crveno-roze, `default`) | `HIGH_CO` | **Per-message** pravilo: jedno jedino očitavanje je prešlo CO prag. Zato dolazi u naletima (spike), a ne ravnomerno. | `b8:27` |
| **Sustained heat** (`default`) | `SUSTAINED_HIGH_TEMP` | **Windowed** pravilo (`HAVING AVG(temp) > 25`): prosek celog window-a je iznad praga → nije trenutni skok nego *trajno* stanje. | `1c:bf` (26.9 °C) |
| **Heat + drying** (`destructive`) | `HEAT_DRYING` | **Korelacija dva uslova odjednom** (`AVG(temp) > 22 AND AVG(humidity) < 55`) — pravi CEP primer, ne obična if provera. | `b8:27` (toplo **i** suvo) |

**Zašto je bitno da su različiti uređaji:** to nije slučajnost nego kalibracija (vidi
`shared/thresholds.md`). Ako te pitaju "da li vaš CEP stvarno razlikuje uslove?" — pokažeš da
`1c:bf` pali *sustained heat* a `b8:27` *heat+drying*, dok `00:0f` (hladan i vlažan) **ćuti**.
Da su pragovi loši, sve bi palilo sve.

**Dugme "Events only"** — sakriva `WINDOW_METRICS` redove. Koristi ga na odbrani: ostanu samo
detektovani događaji i odmah se vidi da CEP radi selekciju, a ne da prosleđuje sve.

### Grafikon "Temperature forecast" — najvažniji panel

Dve serije za **izabrani uređaj** (dropdown gore desno):

- **Puna linija = `actual_avg_temp`** — stvarni prosek temperature po window-u, iz
  `WINDOW_METRICS`. To je "šta se desilo".
- **Isprekidana linija + tačke = `forecast_next_avg_temp`** — predikcija MaaS-a za **sledeći**
  window. To je "šta će se desiti".

**Zašto je isprekidana i zašto je ispred pune linije:** forecast tačka se **ne crta na trenutku
kad je nastala**, nego pomerena unapred za jednu širinu window-a
(`window_end + (window_end − window_start)`) — jer se odnosi na *sledeći* window. Zato
isprekidana linija **vodi** ispred pune. To je vizuelni dokaz da je alert **pre-emptive**
(upozorava unapred), a ne reaktivan.

> Ovo je bio i bug u v1 frontend-a: forecast je crtan na `window_end` triggerujućeg window-a, pa
> se poredio forecast(t+1) sa actual(t) — grafikon je izgledao "pomeren". Sad je poravnato.

**Kako da ga analiziraš (šta reći):**
1. Izaberi **Highly variable** (`1c:bf`) — ima najviše događaja.
2. Prati: kad puna linija raste, isprekidana tačka je **desno i gore** od nje → model je
   predvideo rast pre nego što se desio.
3. Poredi tačku sa punom linijom **u toj istoj tački na X osi** (a ne sa trenutnom vrednošću) —
   tako se vidi koliko je predikcija bila tačna. Model ima test **R² = 0.988**, pa treba da
   naliježe blizu.
4. Tačke su retke a linija gusta — **normalno**: actual se crta za svaki window, a forecast samo
   kad neko CEP pravilo okine (tj. kad ima šta da se javi).

**Ako grafikon zjapi prazan:** ili uređaj još nema 4 window-a u bufferu (~40s), ili si izabrao
`00:0f` koji nikad ne pali alert → nema forecast tačaka (actual linija ipak postoji).

### Kartice "Predictive alerts"

Jedna kartica = jedan enriched alert (jedan CEP događaj + jedan MaaS poziv):

- **`now 25.6°C → next 27.6°C`** — levo actual (iz window-a koji je okinuo pravilo), desno
  predikcija za sledeći window.
- **Delta badge (`+2.0°C`, sa strelicom)** — razlika `next − now`. **Ovo je poenta cele
  arhitekture**: eKuiper kaže "vruće je *sad*", MaaS dodaje "i biće **još** toplije".
- **`forecast v1.0`** — verzija modela koja je dala predikciju (dolazi iz MaaS response-a).
- **`CEP-only`** (umesto verzije) — MaaS nije odgovorio (pao je ili buffer nije pun), ali je
  **alert i dalje emitovan**. To je namerno: pipeline ne sme da stane ako ML padne (D9/Phase-5
  acceptance). Ako ovo pokažeš uz `docker stop iots-maas` — to je gotov odgovor na pitanje
  "šta ako vam model padne?".

### Uređaji u dropdown-u (šta je koji)

| Naziv u UI | MAC | Ponašanje |
|---|---|---|
| **Cool & humid** | `00:0f:00:70:91:0a` | 19.6 °C, 75 % — stabilan, *baseline koji ne pali ništa* |
| **Highly variable** | `1c:bf:ce:15:ec:4d` | 26.9 °C — najtopliji, pali `SUSTAINED_HIGH_TEMP` |
| **Warm & dry** | `b8:27:eb:bf:9d:51` | 22.5 °C, 50 % — pali `HEAT_DRYING` i `HIGH_CO` |

MAC adrese ništa ne znače publici, pa UI uz svaku piše i profil ("cool & humid") — to je isti
razlog zašto legenda stoji stalno na ekranu umesto u tooltip-u (na projektoru se hover ne vidi).

### Bonus demo: promeni window uživo (bez diranja SQL-a)

U `docker\.env` postavi `WINDOW_TYPE=hopping` i `WINDOW_STEP=5`, pa samo re-provision-uj:

```powershell
docker compose -f docker/docker-compose.yml --profile mqtt --profile app `
  --profile cep --profile ml --profile web up -d --force-recreate ekuiper-provision
```

Za ~10s badge u zaglavlju sam pređe sa `window tumbling · 10s` na `window hopping · 10s / 5s`,
a događaji počnu da stižu **duplo češće** (window je i dalje 10s širok, ali se emituje na 5s, pa
se prozori preklapaju). Grafikon i dalje radi. Poenta koju saopštavaš: **window je env-templated
u `provision.sh`, SQL pravila se ne diraju** (D6).

Dve stvari koje je korisno znati ako pitaju:

- **`hopping`/`session` zahtevaju `WINDOW_STEP`.** Bez njega bi se generisao neispravan SQL
  (`HOPPINGWINDOW(ss, 10, )`) i pravilo bi tiho ostalo nekreirano — zato `provision.sh` **pada
  odmah** sa jasnom porukom (`requires WINDOW_STEP`, exit 1).
- **`sliding` emituje jedan event po svakoj dolaznoj poruci** — to je *definicija* sliding
  window-a u eKuiper-u, nije bug. Otud "gomila event-ova odjednom" u Network tab-u. Frontend to
  preživi (pufer + downsampling na 1s), ali za demo koristi `hopping` — čitljivije je.

`WINDOW_SIZE` ostavi na 10 i `LAG_WINDOWS` na 4 — model je treniran na tome (vidi sekciju 6).

---

## 5d. Šta je profesor tražio i kako da vizuelno demonstriraš svaku tačku

| Tačka zadatka | Šta profesor traži | Kako da pokažeš (5-10 sekundi) |
|---------------|---------------------|--------------------------------|
| **1.** Unaprediti Analytics iz P2 da koristi (a) eKuiper CEP i (b) MaaS REST | Da Analytics više ne radi ručnu analizu | Otvori `services/analytics-service/app/main.py` i `events.py` — pokaži da nema starog "window" fajla. Pokaži `[PREDICTIVE ALERT]` liniju u log-u koja spaja eKuiper `SUSTAINED_HIGH_TEMP` + MaaS `next 27.6°C`. |
| **2.** eKuiper pretplaćen na isti topic kao Analytics u P2, primenjuje pravila, emituje na novi topic | Kompletno je definisan CEP sloj | Pokaži `ekuiper/rules/*.json` (4 pravila) i output-uj: `docker exec iots-mosquitto mosquitto_sub -t "sensors/telemetry" -C 1` (raw ulaz) pa isto sa `-t "sensors/events" -C 1` (obrađeni izlaz). Pomeni da su pravila provisionovana **preko REST-a** iz `provision.sh`, ne UI klikanjem. |
| **3.** MaaS = Python + FastAPI + scikit-learn, klasifikacija/regresija na vremenskoj seriji | Da model realno predviđa | Otvori http://localhost:8000/docs → izvrši `/predict` na primeru. Ubi MaaS (`docker stop iots-maas`) i pokaži da Analytics dalje radi (fallback). Pokaži `curl :8000/model/info` sa test R²=0.988 i MAE=0.073°C. |
| **4.** Sve u Docker kontejnerima + web app | Jedna komanda podiže pipeline | `docker ps` → 8 kontejnera. Pokaži dashboard http://localhost:8080. Napomeni: `docker stop iots-webapp` → sve nastavlja jer je webapp **non-blocking** (`docker ps` opet, vidiš da Analytics/MaaS/eKuiper i dalje rade). |
| **5.** Kod na GitHub-u + kratak opis mikroservisa | Repo javan + čitljiv | Otvori `https://github.com/gospaleks/iots-3` → pokaži README (Reused/Modified/New tabela) i `objasnjenje.md` (ovaj fajl, u kome je paragraf po servisu). |

### Kratke replike ako te pitaju detalje

- **"Zašto Random Forest a ne LSTM?"** → "RF sa lag features je jednostavan baseline koji je
  postigao R²=0.988 na test setu. LSTM/GBRT bi bili sledeći korak ako treba manja MAE, ali za 10s
  prozor i temperaturu koja je stabilna, RF je dovoljan i brz (predikcija u milisekundama,
  bezuslovno unutar 1s Analytics timeout-a)."

- **"Kako se pravila u eKuiper-u menjaju bez redeploy-a?"** → "Ne menjaju se u produkciji — svrha
  provisioning-a preko REST-a je da je reproduktivno. Ako treba nov threshold, izmeni `.env`, pa
  `docker compose --profile cep run --rm ekuiper-provision` — DELETE-then-POST je idempotent."

- **"Šta je Feature parity?"** → "`maas/features.py` je jedini fajl koji zna kako se pravi feature
  vektor. Uvezen je i u `train.py` i u `app.py` — `from features import feature_vector`. Bez ovoga
  je moguće da treniraš na jednom obliku a servis šalje drugi (klasičan train/serve skew), pa se
  metrike u prod-u razlikuju od test seta."

- **"Šta ako Mosquitto padne?"** → "Ingestion, Storage i Analytics imaju `restart: unless-stopped`
  u compose-u i broker adapter reconnect logiku. Kad broker vrati, servisi se ponovo pridruže."

### Vrlo brzi demo (2 minuta ekrana)

1. `docker ps` — svi kontejneri
2. http://localhost:8080 — dashboard sa Socket.IO connected pilulom + live alertima
3. `docker logs -f iots-analytics` (10 sekundi) — vidiš `[PREDICTIVE ALERT] ...` u realnom vremenu
4. http://localhost:8000/docs → `/predict` primer → 200
5. `docker stop iots-maas` → nazad na dashboard → alerti sada CEP-only (nema plavog forecast dot)
6. `docker start iots-maas` → alerti opet imaju forecast

**Verifikacija E2E — inline komande za copy/paste:**

```powershell
# Analytics /stats — buffer depth + eventsByType
curl http://localhost:3003/stats

# MaaS model card
curl http://localhost:8000/model/info

# Alertovi u realnom vremenu (Ctrl+C za izlazak)
docker logs -f iots-analytics | Select-String "PREDICTIVE ALERT"

# Sirovi eKuiper eventi (izlazi posle 5 poruka)
docker exec iots-mosquitto mosquitto_sub -t "sensors/events" -C 5

# Web app snapshot
curl "http://localhost:3003/api/alerts?limit=5"

# Predict ručno (isti poziv koji Analytics interno pravi)
curl -X POST http://localhost:8000/predict `
  -H "Content-Type: application/json" `
  -d '{
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
> `[PREDICTIVE ALERT]`, i **push-uje sve u web app preko Socket.IO**. React + shadcn/ui
> dashboard prikazuje pipeline traku, event stream, alert kartice i actual-vs-forecast chart.
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
