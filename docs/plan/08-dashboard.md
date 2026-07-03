# Iteration 8/9 — Dashboard (OPTIONAL, last)

**Goal:** A visual way to *watch* the live system. **Optional**, built after all scenarios
pass; never a prerequisite for running benchmarks.

> **As-built (Iteration 9) — deliberately de-scoped.** The original plan below proposed a new
> NestJS **API gateway** (WebSocket `docker stats` stream, SSE alert feed, REST endpoints that
> shell-exec the benchmark scripts) + a results table. That was dropped on purpose: it adds a
> whole backend service and a shell-execution surface, against the "keep it simple / don't
> disrupt requirements" constraint. What shipped is a **frontend-only, read-only live monitor**
> that polls the three services' existing `/stats` endpoints. No new backend service, no
> WebSocket/SSE, no scenario shell-exec. See [../notes/08-dashboard.md](../notes/08-dashboard.md).

## What shipped

- **`dashboard/`** — Vite + React + TypeScript + Tailwind v4 + **shadcn/ui** (Base UI registry),
  **TanStack Query** (polling + loading/error state), **axios**, charts via shadcn's **Chart**
  (Recharts) wrapper. No socket.io (the backend speaks no WebSocket; polling is the only path).
- Polls `GET /stats` on ingestion (:3001), storage (:3002), analytics (:3003) at a UI-selectable
  cadence (1/2/5 s) and renders, for the **currently-running broker**:
  - stat cards (publish rate, derived stored rate, total stored, transport latency, event→alert
    latency, alerts),
  - throughput chart (published vs stored, msg/s) + transport-latency chart (incremental ms),
  - data-integrity panel (`seq` missing/gaps/duplicates/out-of-order + conflicts + buffered),
  - latest-window panel (avg temp/humidity/CO + red alert banner when over threshold),
  - per-service health dots + broker badge.
- One interactive control: **Trigger burst** → existing ingestion `POST /burst` (live Scenario C).
- **Backend change (additive only):** CORS enabled on all three services, env-gated by
  `CORS_ORIGINS` (default `*`). Only adds HTTP response headers — zero effect on the broker data
  path, measurements, or benchmark scripts.

## Constraints (DECISIONS §3) — all honored

- Benchmarks remain runnable standalone via the shell scripts with the dashboard stopped.
- The dashboard only **visualizes** measurements — it does not replace `docker stats` / bench-tool
  data collection, and adds no broker bypass (REQUIREMENTS §4.2).
- Each service runs one `BROKER_TYPE`, so the live view reflects one broker at a time; true
  MQTT-vs-Kafka side-by-side lives in the static CSVs / report (out of scope for the live UI).

## Verification

- `npm run build` / `tsc --noEmit` / `npm run lint` clean; preview server serves the SPA.
- Live run (WSL2 + Docker): bring up `--profile <broker> --profile app`, `cd dashboard && npm run
  dev`, confirm live metrics + burst + broker switch; re-run a `scenario-*.sh` with the dashboard
  stopped to prove it's off the benchmark path.

## Commit

`feat(dashboard): thin read-only live monitor (Vite/React/shadcn) + service CORS`

---

## Original plan (superseded — kept for context)

- `dashboard/api-gateway` (NestJS): REST scenario triggers (`POST /scenarios/{a,b,c,d}` →
  shell-exec benchmark scripts); WebSocket gateway streaming `docker stats`; SSE feed of Analytics
  alert logs.
- `dashboard/ui` (React + Vite, shadcn/ui + Tailwind): live throughput chart (Recharts), MQTT vs
  Kafka; alert feed; results table (TanStack Table), populated after a run.
