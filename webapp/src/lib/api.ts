// Data layer for the Analytics service: REST snapshots + Socket.IO live streams.
// The browser only ever talks to Analytics (port 3003) — never MQTT (D11).
import { io, type Socket } from "socket.io-client"

export const API_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:3003"

// ─── Wire shapes (mirror shared/message-contract.md) ────────────────────────

/** One `sensors/events` message relayed by Analytics on the `event` channel. */
export interface CepEvent {
  event_type: string
  device: string
  // Windowed types (WINDOW_METRICS / SUSTAINED_HIGH_TEMP / HEAT_DRYING) carry
  // the rollup + window bounds (epoch ms). HIGH_CO is per-message: ts + co + temp.
  ts?: number
  window_start?: number
  window_end?: number
  avg_temp?: number
  max_temp?: number
  min_temp?: number
  avg_humidity?: number
  avg_co?: number
  avg_lpg?: number
  avg_smoke?: number
  sample_count?: number
  co?: number
  temp?: number
}

/** Enriched predictive alert emitted on the `alert` channel. `ts` is float SECONDS. */
export interface EnrichedAlert {
  ts: number
  device: string
  event_type: string
  actual_avg_temp: number | null
  forecast_next_avg_temp: number | null
  forecast_available: boolean
  model_version: string | null
  message: string
  window_start?: number | null
  window_end?: number | null
  decision_time_ms?: number
}

// ─── Event-type metadata (plain-English, for a live audience) ────────────────

export type Severity = "routine" | "notable" | "critical"

export interface EventTypeMeta {
  label: string
  meaning: string
  severity: Severity
}

export const EVENT_TYPES: Record<string, EventTypeMeta> = {
  WINDOW_METRICS: {
    label: "Window metrics",
    meaning: "10-second rollup emitted every window — the baseline heartbeat.",
    severity: "routine",
  },
  HIGH_CO: {
    label: "High CO",
    meaning: "A single reading crossed the CO threshold — per-message spike.",
    severity: "notable",
  },
  SUSTAINED_HIGH_TEMP: {
    label: "Sustained heat",
    meaning: "A window's average temperature stayed above the threshold.",
    severity: "notable",
  },
  HEAT_DRYING: {
    label: "Heat + drying",
    meaning: "Hot AND dry at once — a correlated two-condition CEP pattern.",
    severity: "critical",
  },
}

export function eventMeta(type: string): EventTypeMeta {
  return (
    EVENT_TYPES[type] ?? {
      label: type,
      meaning: "Detected event.",
      severity: "notable",
    }
  )
}

/** Map a severity onto a shadcn Badge variant (semantic tokens, no raw colors). */
export function severityVariant(
  sev: Severity,
): "secondary" | "default" | "destructive" {
  if (sev === "critical") return "destructive"
  if (sev === "notable") return "default"
  return "secondary"
}

// ─── Device profiles (the 3 dataset sensor arrays) ──────────────────────────

export interface DeviceProfile {
  label: string
  hint: string
}

const DEVICE_PROFILES: Record<string, DeviceProfile> = {
  "00:0f:00:70:91:0a": { label: "Cool & humid", hint: "stable, cooler, more humid" },
  "1c:bf:ce:15:ec:4d": { label: "Highly variable", hint: "swings hot and dry" },
  "b8:27:eb:bf:9d:51": { label: "Warm & dry", hint: "stable, warmer, drier" },
}

/** Strip the ingestion fan-out suffix (`<mac>-3`) back to the bare MAC. */
export function baseDevice(device: string): string {
  return device.replace(/-\d+$/, "")
}

export function deviceProfile(device: string): DeviceProfile {
  return (
    DEVICE_PROFILES[baseDevice(device)] ?? {
      label: "Sensor",
      hint: "environmental sensor array",
    }
  )
}

// ─── REST snapshot fetchers ─────────────────────────────────────────────────

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json() as Promise<T>
}

export const fetchEvents = (limit = 150) =>
  getJSON<CepEvent[]>(`/api/events?limit=${limit}`)

export const fetchAlerts = (limit = 100) =>
  getJSON<EnrichedAlert[]>(`/api/alerts?limit=${limit}`)

export const fetchDevices = () =>
  getJSON<{ devices: string[] }>("/api/devices").then((r) => r.devices)

// ─── Socket.IO ──────────────────────────────────────────────────────────────

export function connectSocket(): Socket {
  return io(API_URL, { transports: ["websocket", "polling"] })
}
