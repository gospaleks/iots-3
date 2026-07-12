# PHASE 7 — Web app (React + Vite + shadcn/ui + Tailwind)

> Part of `IMPLEMENTATION_PLAN.md`. Read `SESSION_STATE.md` first.

## 0. Context to load first
- Read: `IMPLEMENTATION_PLAN.md` §1, §2.1–§2.3, §5; `docs/IoTS-3-EXPLAINED.md` §7.
- Depends on: **Phase 5 DONE** — Analytics is emitting Socket.IO `event` + `alert` and serving
  `/api/*` snapshot routes; `sensors/events` carries `WINDOW_METRICS`. Phase 6 optional (more
  event types to show).
- Invariants: the app is **read-only and non-blocking** (D10) — the pipeline must run whether or
  not it is up. It talks to **Analytics** (Socket.IO for live data + REST for snapshots), **not**
  to the MQTT broker.

## 1. Goal
A focused, polished dashboard that shows the new pipeline working: a live **CEP event feed**, the
**enriched predictive-alert feed**, and a **predicted-vs-actual temperature chart** per device.
Live updates arrive over **Socket.IO** from Analytics; initial/historical loads come from
Analytics **REST snapshots** via TanStack Query + axios.

## 2. Chosen stack (locked for this phase)
- **React + Vite** (TypeScript)
- **shadcn/ui** (base-ui variant) + **Tailwind CSS** for components/styling
- **TanStack Query** + **axios** for REST snapshots (`/api/events`, `/api/alerts`, `/api/forecast/:device`)
- **socket.io-client** for the live `event` / `alert` streams
- a chart lib for the predicted-vs-actual view (e.g. `recharts`)

> When implementing in Claude Code, add the **shadcn** (and base-ui) skill/MCP at the start of
> this phase and scaffold components from there. Only pull in TanStack Query / socket.io-client
> if the corresponding data path is actually used (both are — live via socket.io, snapshot via REST).

## 3. Entry criteria
- Phase 5 acceptance passed; `curl localhost:3003/api/alerts?limit=5` returns JSON and a
  socket.io client receives `event` / `alert`.
- Analytics Socket.IO endpoint reachable from the browser host; CORS allows the app origin
  (`SOCKETIO_CORS_ORIGINS` / `CORS_ORIGINS`).

## 4. Steps
1. **Scaffold:** `npm create vite@latest webapp -- --template react-ts` inside `webapp/`.
   Init Tailwind + shadcn/ui (base-ui); add `@tanstack/react-query`, `axios`,
   `socket.io-client`, and a chart lib.
2. **Env:** `webapp/.env` → `VITE_API_URL=http://localhost:3003` (Analytics base URL; used for
   both the axios client and the socket.io connection).
3. **Data layer:**
   - `useSocket()` — connect `io(VITE_API_URL)`, subscribe to `event` and `alert`, push into
     React state (cap arrays to a rolling N to avoid unbounded growth).
   - **TanStack Query** hooks over an axios client for initial snapshots:
     `useEvents()` → `GET /api/events`, `useAlerts()` → `GET /api/alerts`,
     `useForecast(device)` → `GET /api/forecast/:device`. Seed the UI from snapshots, then let
     socket.io keep it live (merge new socket items into the query cache).
4. **Views (shadcn components):**
   - **Event feed:** table/stream of `event` colored by `event_type`
     (`WINDOW_METRICS` muted; `HIGH_CO`/`SUSTAINED_HIGH_TEMP`/`HEAT_DRYING` highlighted).
   - **Predictive alerts:** cards from `alert` showing device, event, actual vs forecast, model version.
   - **Predicted-vs-actual chart:** per selected device, plot actual `avg_temp` (from
     `WINDOW_METRICS` events) as the line and `forecast_next_avg_temp` (from `alert`) as points
     offset one window ahead. This is the money shot for the demo.
   - Optional: per-device status tiles (latest avg_temp / humidity / co).
5. **Containerize:** `webapp/Dockerfile` (build with Node, serve static with nginx) + compose
   service under a `web` profile, mapped to e.g. `:8080`. Do **not** make any other service
   `depends_on` the web app.
6. **Non-blocking check:** stop the web app; confirm the pipeline (Analytics alerts, MaaS) is
   unaffected.

## 5. Files created / modified
- `webapp/` (Vite app: `src/`, `useSocket` hook, TanStack Query hooks, axios client, views,
  shadcn components, `.env`, `Dockerfile`)
- `docker/docker-compose.yml` (+ `webapp`, profile `web`)

## 6. Acceptance criteria (exit gate)
- [x] App loads initial data from `/api/*` (TanStack Query) and then updates live via socket.io.
      *(verified: `useLiveStreams` seeds from `useQuery` snapshots then subscribes to `event`/`alert`)*
- [x] Event feed + predictive-alert feed render; predicted-vs-actual chart updates as events/alerts arrive.
      *(verified in the browser: HIGH_CO rows stream in the feed; alert cards show actual vs forecast; chart plots forecast dots)*
- [x] App runs as a container via the `web` profile; nothing depends on it.
      *(compose: no `depends_on` refers to `webapp`; port 8080 → nginx :80)*
- [x] Pipeline still runs with the web app stopped.
      *(verified during dev with `docker stop iots-webapp` — Analytics + MaaS + eKuiper untouched)*

## 7. How to verify
```bash
cd webapp && npm install && npm run dev      # dev against VITE_API_URL=http://localhost:3003
# or containerized:
docker compose --profile web up -d webapp    # open http://localhost:8080
```
With the full stack up, watch events/alerts populate and the chart draw predicted vs actual.

## 8. Write back to SESSION_STATE.md
- Phase 7 → ✅ DONE; note the app URL/port, the `VITE_API_URL` used, and that live=Socket.IO /
  snapshots=REST; Next → Phase 8.

## 9. Notes / gotchas
- Live data and snapshots both come from **Analytics** (`:3003`), not the broker — the browser
  never speaks MQTT.
- If opening from another machine, set `VITE_API_URL` to the host's IP and ensure Analytics CORS
  (`SOCKETIO_CORS_ORIGINS` / `CORS_ORIGINS`) allows that origin.
- Keep it read-only; window switching stays an env/re-provision operation (D6), not a UI action.
