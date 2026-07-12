# webapp/ — React + Vite + Tailwind + Socket.IO dashboard

Focused, read-only dashboard for the IoTS Project 3 pipeline. Talks to the **Analytics** service
(never MQTT directly — D11): **Socket.IO** for the live `event` / `alert` streams and **REST**
for initial snapshots (`/api/events`, `/api/alerts`, `/api/forecast/{device}`, `/api/devices`).

## Views

- **CEP event feed** — rolling table of `sensors/events` messages, color-coded by
  `event_type` (`WINDOW_METRICS` muted; `HIGH_CO` amber; `SUSTAINED_HIGH_TEMP` /
  `HEAT_DRYING` red).
- **Predictive alerts** — cards from the enriched-alert stream showing device,
  event type, actual `avg_temp`, MaaS `forecast_next_avg_temp`, `model_version`,
  and the full `[PREDICTIVE ALERT]` message.
- **Predicted-vs-actual `avg_temp`** — Recharts line chart per selected device
  (white solid = actual, blue dashed = forecast one window ahead).
- **Socket.IO status pill** in the header (connected / disconnected).

## Stack

React 18 · Vite 6 · TypeScript · Tailwind CSS 3 · TanStack Query 5 · axios ·
socket.io-client 4 · Recharts 2.

## Dev

```bash
cd webapp
npm install
VITE_API_URL=http://localhost:3003 npm run dev   # http://localhost:5173
```

## Container

```bash
# baked at build time; override for a non-localhost demo
docker compose -f docker/docker-compose.yml --profile web build webapp
docker compose -f docker/docker-compose.yml --profile web up -d webapp
# → http://localhost:8080
```

Multi-stage build: `node:22-alpine` compiles the SPA, `nginx:1.27-alpine` serves the
static bundle (SPA fallback + gzip). `VITE_API_URL` bakes in through the compose
build `args:` — set `WEBAPP_API_URL` in `docker/.env` for a non-localhost host.

## Non-blocking (D10)

Under the `web` profile; **nothing depends on it**. The pipeline (Analytics + MaaS +
eKuiper + Storage + Ingestion) runs whether the app is up or down — killing
`iots-webapp` doesn't affect anything else.
