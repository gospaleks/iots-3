# webapp — Sensor Pipeline dashboard

Live dashboard for the IoTS Project 3 pipeline. Visualizes eKuiper CEP events, the
MaaS next-window temperature forecast, and Analytics' enriched predictive alerts.

## Stack

- **React 19 + Vite + TypeScript**
- **shadcn/ui** (Base UI primitives, `luma` style, Phosphor icons) — components live
  in `src/components/ui/`, added via `npx shadcn@latest add …`. Semantic tokens only.
- **Tailwind CSS v4** (theme tokens in `src/index.css`)
- **Recharts** (via the shadcn `Chart` wrapper) for the forecast line
- **socket.io-client** for the live streams

## How it talks to the backend

The browser only talks to the **Analytics** service (`VITE_API_URL`, default
`http://localhost:3003`) — never MQTT:

- **Socket.IO** channels `event` (every `sensors/events` message, incl. WINDOW_METRICS)
  and `alert` (enriched predictive alerts).
- **REST** snapshots `/api/events`, `/api/alerts`, `/api/devices` to seed the UI on load.

`src/hooks/use-live-streams.ts` seeds from REST then follows the socket, buffering
incoming messages and flushing on an interval so a burst of events (every window
boundary, or one-per-message under a sliding window) never thrashes React.

The forecast chart (`src/components/forecast-chart.tsx`) plots actual vs. forecast on
one numeric time axis, bucketed to the second, so it stays readable under **tumbling,
hopping, or sliding** windows. The active window is fetched once from Analytics
(`GET /api/window`) and shown in the header — Analytics echoes the same `WINDOW_*` keys
that provision eKuiper, so changing the window means restarting the stack and reloading
the page.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173, expects Analytics on :3003
npm run build    # tsc -b + vite build
```

## Container

Built as part of the `web` compose profile (host `:8080` → nginx `:80`). `VITE_API_URL`
is baked at build time via the compose build arg `WEBAPP_API_URL`.
