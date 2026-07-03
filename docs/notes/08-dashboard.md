# 08 — Optional dashboard (live read-only monitor)

A small web UI to *watch* the running system during a demo. **Optional, off the benchmark
path, built last.** It does not change anything about how the project meets the requirements —
it only visualizes data the services already expose.

## What it is

`dashboard/` — a **Vite + React + TypeScript + Tailwind v4 + shadcn/ui** single-page app. It
polls the three services' existing HTTP control surfaces and draws live charts/cards:

- **ingestion** `:3001 /stats` → publish rate, baseline, devices, bursting flag
- **storage** `:3002 /stats` → received/stored/conflicts/buffered, `seq` integrity, transport latency
- **analytics** `:3003 /stats` → windows/alerts, transport + event→alert latency, the latest window

Run it with `cd dashboard && npm run dev` → <http://localhost:5173>. It is **not** in any compose
profile and is never required to run benchmarks.

## The decisions that matter

- **Scoped way down from the original plan.** `plan/08` envisioned a NestJS API gateway with
  WebSocket/SSE streaming and endpoints that shell-exec the benchmark scripts (~4–5 days, a whole
  new backend + a shell-exec surface). We dropped all of that. The shipped version is
  **frontend-only and read-only** (plus one burst button). Less code, nothing new to break,
  requirements untouched.
- **Polling, not socket.io.** None of the services speak WebSocket; the only realtime path is
  polling `/stats`. **TanStack Query** with `refetchInterval` gives live updates *and* loading/error
  state for free — simpler than standing up a socket layer. So the suggested `socket.io` was not used.
- **CORS, not a dev proxy.** The browser is a different origin from the services, which had no CORS.
  We enabled CORS on all three (`app.enableCors` / FastAPI `CORSMiddleware`), gated by
  `CORS_ORIGINS` (default `*`). This is **additive** — it only sets HTTP response headers; the
  broker data path, the measurements, and the benchmark scripts are completely unaffected.
- **One broker at a time.** Each service runs a single `BROKER_TYPE`, so the live view shows
  whichever broker is up (the analytics `broker` field drives the badge). True simultaneous
  MQTT-vs-Kafka comparison only exists in the static result CSVs / the report — not the live UI.

## How the live numbers are built

The `/stats` endpoints expose **cumulative** counters, so the dashboard derives per-interval
signals client-side, on a fixed sampling clock (`useDashboardData`):

- **stored rate** = Δ `writer.stored` / Δt between samples (Δt is wall-clock, so it stays correct
  when you change the poll interval).
- **transport latency (per interval)** = Δ(`avg`·`count`) / Δ`count` — the incremental average over
  the last tick, which is far more "live" than the flat cumulative average.

The publish rate comes straight from the simulator's `currentRatePerSec`.

## If asked

- *"Does the dashboard affect the benchmarks?"* No. It's read-only, off the data path, not in any
  compose profile. The only backend change is CORS headers. Stop it and re-run any
  `scenario-*.sh` — identical output.
- *"Why not socket.io / a websocket?"* The services don't expose one; polling `/stats` via TanStack
  Query is simpler and already gives loading/error/retry handling.
- *"Why can't I see MQTT and Kafka side by side live?"* Only one broker stack runs at a time; the
  side-by-side comparison is in the report's result tables, not the live monitor.
- *"Is a UI required by the project?"* No — REQUIREMENTS §10 lists no UI. This is a presentation
  nicety, explicitly optional (DECISIONS §3).
