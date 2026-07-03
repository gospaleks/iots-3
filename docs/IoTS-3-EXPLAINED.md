# IoTS-3-EXPLAINED.md
## Project 3, explained plainly — what it wants, what the concepts are, and how I'd build it

This is the companion to `REQUIREMENTS-IoTS-3.md`. That file is the formal "what." This one is the "so what and how" — written to make sure the ideas land before you write any code.

---

## 1. The one-paragraph version

In Project 2 your **Analytics** service did all the thinking itself: it subscribed to the sensor stream and ran a hand-coded 10-second tumbling window to compute averages and fire alerts. Project 3 says: *stop doing all the analysis by hand — instead, plug in two specialist components and let Analytics coordinate them.* The two specialists are **eKuiper** (a stream-processing / CEP engine that watches the raw sensor stream and fires "events of interest" using declarative rules) and a **MaaS** service (a small web service wrapping a trained machine-learning model that answers prediction questions over HTTP). Analytics now listens to eKuiper's events and, for each one, asks the ML model a question, then produces a smarter alert that combines "a rule tripped" **and** "the model predicts X." Everything is Dockerized, there's a small web/mobile app to see it happening, and it goes on GitHub.

That's the whole project. The rest of this doc unpacks each moving part.

---

## 2. The mental model: from "one brain" to "brain + two specialists"

**Before (Project 2):**

```
sensors → MQTT → Analytics (does everything: window + averages + threshold alert)
```

**After (Project 3):**

```
sensors → MQTT → eKuiper ──(detected events)──► MQTT ──► Analytics ──REST──► MaaS (ML model)
                  rules/CEP        new topic                  orchestrates      predictions
```

Think of it as a division of labor:

- **eKuiper = the rule-based expert.** It knows *known* patterns. "If average temp over 10s exceeds 50°F, that's an event." "If temp is rising while humidity drops, that's an event." Deterministic, fast, no training. It's basically a tiny SQL engine that runs continuously over a moving stream instead of a static table.
- **MaaS = the learned brain.** It knows *patterns it was trained on*. "Given the last N readings, I predict the next temperature will be 54.9°F" (regression) or "this reading pattern looks anomalous, probability 0.87" (classification). It doesn't watch the stream — it just answers questions when asked, over REST.
- **Analytics = the coordinator.** It no longer computes windows itself. It waits for eKuiper to say "something happened," then asks MaaS "what do you predict about this?", then combines both into an enriched decision.

Why is this a good architecture (and why the professor is teaching it)? Because it's exactly how real IoT/edge analytics are built: a lightweight **stream engine at the edge** handles high-volume rule matching cheaply, and a **model service** provides the expensive ML intelligence on demand, decoupled and independently scalable/retrainable. You're building the "CEP + ML-as-a-service" pattern in miniature.

---

## 3. Concept primer (skip what you already know)

**Stream processing** — running continuous queries over data *as it flows*, instead of storing it and querying later. A normal SQL query runs once over a fixed table. A streaming query runs forever over an unbounded stream, emitting results as new data arrives. Windows (below) are how you turn an infinite stream into finite chunks you can aggregate.

**Windows** — you already met the tumbling window in Project 2. eKuiper supports several:
- *Tumbling*: fixed, non-overlapping (e.g. every 10s). Same as Project 2.
- *Hopping*: fixed size, slides by a smaller step (overlapping).
- *Sliding*: emits on each event, looking back a fixed duration.
- *Session*: groups bursts separated by gaps.
You'll mostly use tumbling (familiar) and maybe sliding (for rate-of-change).

**CEP (Complex Event Processing)** — detecting *meaningful patterns* across multiple events, not just single-value thresholds. "Temp > 50" is a simple filter. "Temp rose by >5° within 30s **and** humidity fell **and** it's the same device" is a complex event. CEP = the engine that spots these composite conditions in real time. eKuiper does both simple filters and windowed/correlation logic, so it covers the whole spectrum.

**eKuiper** — an open-source (LF Edge) lightweight edge stream-processing engine. Mentally: "a tiny Flink/Spark-Streaming you can run on a Raspberry Pi." You give it **sources** (where data comes in — for you, MQTT), **rules** (SQL that transforms/filters/aggregates), and **sinks** (where results go — for you, MQTT again, to a new topic). It's config-driven: define a stream, write SQL rules, each rule has an action (sink). No code to write — it's SQL + JSON. *This is the new tool for you, so it gets a full deep-dive in §4.*

**MaaS (Model-as-a-Service)** — the pattern of taking a trained ML model and putting it behind a web API so other services call it over HTTP instead of importing the model directly. Decouples the model (its heavy libraries, its lifecycle, its retraining) from the consumers. Your MaaS is a small Flask/FastAPI app: load model at startup → expose `POST /predict` → return a prediction. That's it.

---

## 4. eKuiper — the deep dive

This is the piece you haven't used before, so here's the full picture: what it is, why it's in this project, how it thinks, and how to stand it up.

### 4.1 What eKuiper is, and why it's here

eKuiper (full name **LF Edge eKuiper**, formerly "Kuiper") is a small open-source **stream-processing / rule engine** built for the edge. It's written in Go, ships as one lightweight container (tens of MB of RAM — the same edge-friendly weight class as Mosquitto), and its entire job is: *take a continuous stream of messages in, run SQL-like rules over it in real time, and push results out.* Mentally, it's "a tiny Apache Flink / Spark Structured Streaming that runs happily on a Raspberry Pi."

**Why it's in Project 3:** in Project 2 your Analytics service hand-coded the stream logic — the 10s tumbling window, the averaging, the threshold check — in Python. That works, but your analysis logic is then baked into application code: to change a rule you edit Python and redeploy. eKuiper externalizes that logic into **declarative SQL rules** you can add, change, or remove at runtime with a REST call, without touching or redeploying any service. That's the lesson the professor is teaching: *stream analytics belongs in a purpose-built stream engine, not hand-rolled inside every consumer.* eKuiper does the same windowing + detection you already did by hand — just cleaner, hot-swappable, and far more capable (multiple window types, joins, pattern matching, dozens of sources/sinks).

### 4.2 The mental model: source → rule → sink

Everything in eKuiper is three moving parts:

```
   MQTT topic                 SQL rule                    MQTT topic
 sensors/telemetry  ───►  [ SELECT ... FROM stream  ]  ───►  sensors/events
   (SOURCE)              [ WHERE / GROUP BY window  ]      (SINK / "action")
                         [ HAVING ...               ]
```

- **Source** — where data comes *in*. You declare a **stream** that binds a named table (`sensor_stream`) to an MQTT topic + payload format (JSON). After that, `FROM sensor_stream` in SQL means "the live messages arriving on that topic."
- **Rule** — a **continuous SQL query**. Normal SQL runs once over a static table; an eKuiper rule runs *forever* over the moving stream and emits a result whenever its logic produces output (on each message, or once per window close). This is where your detection logic lives.
- **Sink (action)** — where results go *out*. Each rule has one or more actions; yours is an **MQTT sink** that publishes the rule's output to the new `sensors/events` topic. (Other sinks exist — log, file, REST, databases — you only need MQTT.)

So the whole eKuiper layer = **one stream** (the source binding) + **a few rules** (each = SQL + an MQTT sink). No application code — just definitions you POST to its REST API.

### 4.3 The vocabulary you'll actually touch

- **Stream** — the schema+topic binding (`CREATE STREAM ...`). Think "table definition for a live topic." (It can be schemaless, but declaring fields is cleaner.)
- **Rule** — a JSON object `{ "id", "sql", "actions": [...] }`. The unit you create / start / stop / delete. `sql` is the continuous query; `actions` are the sinks.
- **Window functions** — how you aggregate a stream over time; they live in the `GROUP BY`. You know tumbling from Project 2: `GROUP BY TUMBLINGWINDOW(ss, 10)` = fixed, non-overlapping 10-second buckets. Also `HOPPINGWINDOW`, `SLIDINGWINDOW`, `SESSIONWINDOW`. The unit token sets the time base: `ss` seconds, `mm` minutes, `ms` milliseconds.
- **SQL dialect** — familiar `SELECT / FROM / WHERE / GROUP BY / HAVING`, plus aggregates (`AVG`, `MAX`, `COUNT`), window helpers (`window_start()`, `window_end()`), and stream functions. Key distinction: **`WHERE` filters individual messages** (before aggregation); **`HAVING` filters the aggregated window result**. `GROUP BY device, <window>` gives per-device aggregates per window — exactly what you want.
- **REST management API (port 9081)** — the control plane. You POST streams and rules here and query each rule's status/metrics. This is how you provision reproducibly (§4.7).
- **Manager UI (`emqx/ekuiper-manager`, port 9082)** — optional web console to click around: create/inspect streams and rules, watch throughput per rule. Great for developing and for the live demo — but don't let your rules *live* only here; provision them via REST so they survive a restart.

### 4.4 Run it

Add it to Docker Compose alongside Mosquitto. Image `lfedge/ekuiper` (v2.x, `-slim` is fine). Point its MQTT source at your broker:

```yaml
  ekuiper:
    image: lfedge/ekuiper:2.0-slim      # pin an actual current tag
    container_name: ekuiper
    environment:
      MQTT_SOURCE__DEFAULT__SERVER: "tcp://mosquitto:1883"
      KUIPER__BASIC__CONSOLELOG: "true"
    ports:
      - "9081:9081"                      # REST management API
    depends_on: [mosquitto]
```

(Optional: add `emqx/ekuiper-manager` on port 9082 for a click-around UI while developing — nice for the demo, not required.)

### 4.5 Define the stream

A "stream" tells eKuiper the shape of the incoming data and which topic it lives on:

```sql
CREATE STREAM sensor_stream (
    ts BIGINT, device STRING, co FLOAT, humidity FLOAT,
    light BOOLEAN, lpg FLOAT, motion BOOLEAN, smoke FLOAT,
    temp FLOAT, seq BIGINT, sent_at_ms BIGINT
) WITH (DATASOURCE="sensors/telemetry", FORMAT="JSON");
```

`DATASOURCE` = the raw topic your Ingestion service already publishes to (use your real Project 2 topic name).

### 4.6 Write rules (this is the CEP part)

Each rule is SQL + an MQTT sink to your **new** event topic (`sensors/events`). Aim for 2–3 rules that show range, not just one filter. Examples:

**Rule A — simple threshold** (single-field CEP):
```sql
SELECT device, temp, co, ts, 'HIGH_CO' AS event_type
FROM sensor_stream
WHERE co > 0.01
```

**Rule B — windowed aggregation** (sustained condition — the interesting one):
```sql
SELECT device,
       AVG(temp) AS avg_temp, MAX(temp) AS max_temp,
       AVG(humidity) AS avg_humidity, AVG(co) AS avg_co,
       COUNT(*) AS sample_count,
       'SUSTAINED_HIGH_TEMP' AS event_type
FROM sensor_stream
GROUP BY device, TUMBLINGWINDOW(ss, 10)
HAVING AVG(temp) > 50
```

**Rule C — complex/correlation** (optional, scores well):
```sql
SELECT device,
       AVG(temp) AS avg_temp, AVG(humidity) AS avg_humidity,
       'HEAT_DRYING' AS event_type
FROM sensor_stream
GROUP BY device, SLIDINGWINDOW(ss, 15)
HAVING AVG(temp) > 45 AND AVG(humidity) < 40
```

Each becomes a rule via the REST API:
```json
{
  "id": "sustained_high_temp",
  "sql": "SELECT device, AVG(temp) AS avg_temp, ... HAVING AVG(temp) > 50",
  "actions": [
    { "mqtt": { "server": "tcp://mosquitto:1883", "topic": "sensors/events", "sendSingle": true } }
  ]
}
```

`sendSingle: true` makes each result row its own JSON message (cleaner for Analytics to parse).

### 4.7 Provision it automatically

Don't rely on clicking rules into the UI by hand — that won't survive a restart or a fresh clone. Write a small `provision.sh` that waits for eKuiper's REST API to be up, then `POST`s the stream and each rule:

```bash
curl -s http://ekuiper:9081/streams -d @streams/sensor_stream.json
curl -s http://ekuiper:9081/rules   -d @rules/sustained_high_temp.json
# ... one per rule
```

Run it from an init container or the entrypoint. Now `docker compose up` gives a working CEP layer with zero manual steps — which is exactly what graders and your future self want.

### 4.8 Verify it end-to-end (before you touch Analytics)

Prove the CEP leg in isolation first — it saves hours of "is it eKuiper or Analytics?" debugging later:

1. Bring up Mosquitto + Ingestion + eKuiper only.
2. In one terminal, subscribe to the output topic: `mosquitto_sub -h localhost -t 'sensors/events' -v`
3. Let the simulator publish telemetry that trips a rule; watch events land on `sensors/events`. (If nothing fires, temporarily lower a threshold so you know the wiring works.)
4. Check rule health via REST: `curl http://localhost:9081/rules/sustained_high_temp/status` — the processed/emitted counters should climb.

If events appear on `sensors/events`, the eKuiper layer is *done* and Analytics just has to subscribe to it.

### 4.9 Operational notes & gotchas

- **Container-to-container addressing.** Inside Compose, eKuiper reaches the broker at `tcp://mosquitto:1883` (the service name), not `localhost` — and the MQTT *sink* server is the same. `localhost` inside the eKuiper container is the eKuiper container.
- **Field names must match the JSON exactly.** Stream schema fields (`temp`, `co`, `humidity`, …) must match your payload keys; a typo yields silent `NULL`s.
- **Types must match too.** `ts`/`sent_at_ms` are numbers — declare `BIGINT`; the sensor readings — `FLOAT`. Wrong type = nulls.
- **`WHERE` vs `HAVING`.** `WHERE` = per-message, pre-aggregation (threshold on a raw reading). `HAVING` = on the aggregated window row (threshold on an average). Mixing them up is the #1 rule bug.
- **`sendSingle: true`** on the MQTT sink emits one JSON object per result row instead of a JSON array — keeps Analytics parsing trivial.
- **Provision ordering.** Create the **stream** before any **rule** that references it, and have `provision.sh` poll until eKuiper's REST API answers (a cold `docker compose up` needs a second or two before 9081 is ready).
- **Pin the image tag.** Use a concrete current `lfedge/ekuiper:2.x-slim` tag, never `latest`, so a re-pull can't shift behavior the night before the demo.
- **UI-created rules persist in the container volume.** If you also click some together in the manager during the demo, they stick around and can confuse "why is this rule here?" Keep the REST-provisioned set as the single source of truth; treat the UI as inspect-only.

---

## 5. MaaS — the part that needs a real decision

This is where you actually make a choice: **what does the model do?** The spec says "classification or regression on the sensor time series." Here's how I'd think about it.

### 5.0 About the three tutorials the PDF links

Short verdict: **they're fine as skeletons for the "wrap a model behind REST + Docker" mechanic — which is the core skill the assignment points at — but none of them covers the parts that actually move your grade.** Use them for the plumbing, get the modeling rigor from §5.1.

- **"ML Model Deployment with FastAPI and Docker" (dev.to, Code_Jedi)** — the most directly reusable of the three. A compact end-to-end skeleton: train a scikit-learn model and `joblib.dump` it; write a FastAPI app that loads the model once and exposes `/predict`; add a `python:3.x` Dockerfile running uvicorn; `docker build`/`run`; test with `curl`. Since your Project 2 Analytics is already FastAPI, this is the template I'd base MaaS on. Caveat — and the top comment on the article says this outright — what it calls "deployment" is really just containerization, and it trains on the whole toy dataset with **no train/validation/test split**. You must add that.
- **"Flask Decoded" (Medium, Reza Shokrzad)** — more conceptual than a worked example. Useful for the surrounding checklist: saving the model with joblib/pickle, planning the `/predict` endpoint, the request→predict→JSON cycle, local testing with `unittest` + the framework's test client + Postman, and production concerns (input validation, HTTPS, gunicorn workers). Skim the testing section.
- **"Deploy ML Models as a Service Using Flask" (Towards AI)** — same territory as the Reza piece (a Flask `/predict` walkthrough). It's behind Medium/robots restrictions so I couldn't pull the full text, but it doesn't cover anything the other two don't.

**What all three skip — and what your grade depends on:**
1. **Time-series feature engineering.** The spec explicitly says "sensor streams that form a time series." The tutorials do single-row iris prediction; you need lag windows / rolling features (or an LSTM over sequences). That's the real modeling work — §5.1.
2. **Train / validation / test with reported metrics.** The spec names all three. None of the tutorials splits the data or reports MAE/RMSE/accuracy. Your `train.py` must.
3. **Pipeline integration.** None connects the model to a broker/CEP pipeline — that's the Analytics→MaaS REST wiring in §6, which is the whole point of the project.

So: lift the FastAPI+Docker skeleton from the dev.to piece, borrow the testing checklist from Reza, and get the ML rigor (features, split, metrics) from §5.1.

**Framework note:** the PDF says "Flask (FastAPI)" and links both — either is accepted. I'd use **FastAPI**: it matches your Project 2 Analytics, gives free Swagger docs at `/docs` (nice for the demo), and validates requests cleanly via Pydantic. Flask is completely fine if you prefer it.

### 5.1 My recommendation: temperature (or CO) forecasting — regression

**Task:** given a window of a device's recent readings, predict the temperature one step (or one window) ahead.

**Why this one:**
- It's the cleanest fit for "sensor data that forms a time series" — you're literally forecasting the series.
- **No labeling needed.** The target is just the future value you already have in the data. You slide a window over `iot_telemetry_data.csv` and the label is the next row's `temp`. Supervised regression falls out for free.
- It makes a great demo with eKuiper: eKuiper says "temp is trending up right now"; MaaS says "and I predict it'll hit 54.9°F next window, above threshold" — Analytics fires a **pre-emptive** alert. That "predict before it happens" story is compelling and obviously more than a threshold.
- Trivial to build with scikit-learn; no GPU, small container.

**How to build it (sklearn path):**
1. Load the CSV. Sort by `device`, then `ts`.
2. **Feature engineering — lag features:** for each row, build features from the previous *k* readings (e.g. last 5–10 values of `temp`, `humidity`, `co`), plus rolling mean/std, plus maybe `device` one-hot. Target `y` = `temp` at the next step (or the mean temp of the next window).
3. **Split** chronologically: train / validation / test (don't shuffle — it's a time series; use an ordered split or `TimeSeriesSplit`).
4. **Train** a `RandomForestRegressor` or `GradientBoostingRegressor` (strong, zero-fuss baselines). Report **MAE / RMSE / R²** on validation and test.
5. **Serialize** with `joblib.dump(model, "models/model.joblib")`.

**Deep-learning variant (if you want to flex TF/Keras):** an **LSTM** over sequences of the last *k* timesteps predicting the next `temp`. Same data prep (sequences instead of flat lag features). More impressive, more finicky, heavier container. Do this only if you want the DL box ticked; the sklearn version fully satisfies the spec.

### 5.2 Strong alternative: anomaly detection — classification

**Task:** classify a reading/window as normal vs anomalous.

**Why consider it:** it's the *tightest conceptual complement* to eKuiper. eKuiper catches **known** rule-based patterns; the ML model catches **statistical** anomalies the rules don't encode. Together they read as "defense in depth." Great narrative for the report.

**Catch:** you have no ground-truth anomaly labels. Two ways around it:
- **Unsupervised:** `IsolationForest` or a One-Class SVM — train on "normal" data, flag outliers. No labels needed, but "validation/testing" is fuzzier (you'd inject synthetic anomalies to measure detection).
- **Synthetic labels:** define anomalies programmatically (e.g. values beyond N sigma, or physically implausible jumps), label the dataset, train a classifier, report accuracy/precision/recall/F1.

It's a bit more work to make "train/validate/test" rigorous than the forecasting route, which is why forecasting is my default recommendation. But if you want the best story, this is it.

### 5.3 Easy-win alternative: device identification — classification

Predict which of the 3 devices a reading came from. The devices have distinct profiles (cool/humid vs variable vs warm/dry), so a classifier hits high accuracy easily. **Downside:** weakest "time series" angle (it's basically per-row classification) and it doesn't produce a forward-looking prediction that pairs naturally with alerting. Fine as a fallback if you're short on time, but the forecasting route tells a better project story.

### 5.4 The service itself

Small Python app. I'd use **FastAPI** for consistency (your Project 2 Analytics is already FastAPI, so same idioms, and you get auto Swagger docs at `/docs` for free) — but the spec explicitly allows Flask, and the linked tutorials mostly use Flask, so either is fully acceptable.

```python
# app.py (FastAPI sketch)
from fastapi import FastAPI
from pydantic import BaseModel
import joblib

model = joblib.load("models/model.joblib")   # load once at startup
app = FastAPI()

class Features(BaseModel):
    temp_lags: list[float]
    humidity_lags: list[float]
    co_lags: list[float]
    device: str

@app.get("/health")
def health(): return {"status": "ok"}

@app.get("/model/info")
def info(): return {"task": "temp_forecast", "algorithm": "RandomForestRegressor",
                    "features": "lag windows", "version": "1.0"}

@app.post("/predict")
def predict(f: Features):
    X = build_feature_vector(f)              # same transform as training
    yhat = float(model.predict([X])[0])
    return {"prediction": yhat, "unit": "F", "model_version": "1.0"}
```

Ship the trained `model.joblib` inside the image (or a mounted volume). The container must **not** train at boot — training is offline via `train.py`, committed to the repo so it's reproducible.

**Watch out for train/serve skew:** the exact feature transform used at training must be reused at inference. Factor it into one shared function so `train.py` and `app.py` build features identically. This is the #1 bug in MaaS-style projects.

---

## 6. Enhanced Analytics — the glue

The change is smaller than it sounds. Reuse your Project 2 broker adapter; just point it at the **event** topic and add an HTTP call.

Loop:
1. Subscribe to `sensors/events` (eKuiper's output).
2. On each event, build the MaaS feature vector. **Easiest path:** have eKuiper put the aggregates you need *into the event* (that's why Rule B selects `avg_temp`, lags, etc.), so Analytics just reshapes and forwards them — no need to re-buffer raw readings. (Alternative: also subscribe to raw telemetry and keep a per-device ring buffer. More work; only do it if the model needs finer input than the event carries.)
3. `POST` to `http://maas:8000/predict` (use `httpx`/`aiohttp` async so you don't block the subscribe loop).
4. Combine and log:
   ```
   [PREDICTIVE ALERT] 2024-... | device=1c:bf:ce:15:ec:4d
      | eKuiper: SUSTAINED_HIGH_TEMP (avg 52.4°F, 10s window)
      | MaaS: next-window temp 54.9°F (>50 threshold, model v1.0)
      | → pre-emptive alert raised
   ```
5. Optionally push this to the web app (WS/SSE, or re-publish to a `ui/alerts` topic).

**Resilience:** wrap the MaaS call in a timeout; if MaaS is down or slow, still emit the CEP-only alert and note "prediction unavailable." Don't let a flaky model service stall your alerting.

**Do you keep the Project 2 tumbling window in Analytics?** You don't have to — eKuiper now owns windowing. Dropping it makes Analytics pleasingly thin (subscribe → predict → decide). Keep a light version only if you find it useful for building features.

---

## 7. The web/mobile app

Free choice of tech, and it must **not** be required for the pipeline to run. Keep it focused on showing off the new pipeline: a **live CEP event feed**, the **enriched/predictive alerts** from Analytics, and the **MaaS predictions** (e.g. predicted-vs-actual temp chart).

Fastest routes, in rough order of effort:
- **Streamlit** (Python) — quickest possible dashboard; subscribe to MQTT or poll Analytics, draw charts in ~100 lines. Great if you want this done in an afternoon.
- **Plain HTML + MQTT-over-WebSocket** — Mosquitto already exposes WS (9001 in your Project 2 setup). A single static page can subscribe to `sensors/events` and `ui/alerts` directly in the browser via MQTT.js. Zero backend.
- **React/Vite** — if you want something that looks polished for the presentation. More setup, but a clean fit since you're building fresh.

**Decision (locked):** the Project 2 dashboard is *not* being carried over — it was the simplified, presentation-only bit of that project. You're building a **new app from scratch** aimed squarely at "look, rules + ML working together." Concretely, the P3 app should surface three things the old one never did: the **eKuiper CEP event feed** (`sensors/events`), the **Analytics enriched/predictive alerts**, and the **MaaS prediction** (a predicted-vs-actual temp chart reads best). Keep it non-blocking — the pipeline must run whether or not the app is up. Given you're starting clean, I'd reach for **plain HTML + MQTT.js over WebSocket** (zero backend, subscribes straight to the topics) or **Streamlit** if you'd rather stay in Python; step up to **React/Vite** only if you want presentation polish.

---

## 8. Gotchas & decisions to lock early

1. **The "Storage publishes" wording is a red herring.** The PDF says Analytics is subscribed to a topic "to which the Data Storage Service publishes." In your real architecture, Ingestion is the publisher and Storage is subscriber-only. It doesn't matter: spec point 2 pins eKuiper to *"the same topic as Analytics"* (i.e. the raw sensor topic). Keep your existing topology; just attach eKuiper and Analytics to the raw telemetry topic. Only if the professor explicitly wants Storage to be the literal publisher would you add a re-publish from Storage — I wouldn't do it preemptively.
2. **The ML call goes in Analytics, not eKuiper.** eKuiper *can* call REST, but the spec assigns MaaS consumption to Analytics (point 1b). Keep the clean split: eKuiper = CEP, Analytics = ML orchestration. Don't blur it.
3. **Kafka is not part of Project 3.** The PDF is entirely MQTT. Run the MQTT profile. Leave your Kafka adapter in the repo (it shows off the abstraction) but don't wire eKuiper to it.
4. **Provision eKuiper reproducibly.** Rules created by hand in the UI vanish on a fresh clone. Script the REST provisioning so `docker compose up` yields a working pipeline.
5. **Pin your image tags.** Use a concrete current `lfedge/ekuiper` tag, not `latest`, so your demo doesn't break the night before.
6. **Feature-transform parity** between `train.py` and MaaS `/predict` (see §5.4). Share one function.
7. **Don't over-scope the model.** A `RandomForestRegressor` forecasting temp fully satisfies "an ML model, trained/validated/tested." You don't need deep learning unless you want to. Get the pipeline end-to-end first, then upgrade the model if time allows.

---

## 9. Suggested build order

1. **eKuiper up + one rule.** Get raw telemetry flowing in, one simple threshold rule publishing to `sensors/events`. Verify with `mosquitto_sub -t sensors/events`. (This proves the CEP leg fast.)
2. **Rewire Analytics** to subscribe to `sensors/events` and just log the events. Now the eKuiper→Analytics path is done.
3. **MaaS offline first.** Write `train.py`, train the model, save the artifact, sanity-check predictions in a notebook. This is independent work you can parallelize.
4. **Wrap MaaS in the REST service** and containerize. Test `POST /predict` with curl.
5. **Connect Analytics → MaaS.** Add the REST call, emit enriched alerts. Core project now works end-to-end.
6. **Add the 2nd/3rd eKuiper rule** (windowed + complex) for depth.
7. **Web app** last — visualize events, predictions, alerts.
8. **README + GitHub** with a short paragraph per microservice, architecture diagram, and run instructions.

Get steps 1–5 solid before polishing 6–8; that's the graded core.

---

## 10. What I'd want confirmed from you (optional)

Two small things would sharpen the code phase, but safe assumptions are made for both in `REQUIREMENTS-IoTS-3.md`:

- The **exact raw telemetry topic name** your Ingestion service publishes to (placeholder `sensors/telemetry`; the actual project topic is `sensors/telemetry`).
- Whether you want to **keep MQTT-only** for Project 3 (the assumption) or also keep Kafka running.

---

*Companion to `REQUIREMENTS-IoTS-3.md`. eKuiper specifics verified against current `lfedge/ekuiper` documentation.*
