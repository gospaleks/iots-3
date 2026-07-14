// Live pipeline state: seed from REST snapshots, then follow Socket.IO.
//
// Burst resilience is the whole point here. eKuiper can emit a flood of events at
// once (every window boundary, and one-per-message under a sliding window). Rather
// than call setState per socket message — which would thrash React under a flood —
// incoming messages land in refs and a single interval flushes them into state, so
// there is exactly one render per flush no matter the arrival rate. Rolling caps
// keep memory bounded for a long-running demo.
import * as React from "react"

import {
  connectSocket,
  fetchAlerts,
  fetchEvents,
  fetchWindow,
  type CepEvent,
  type EnrichedAlert,
  type WindowInfo,
} from "@/lib/api"

const MAX_EVENTS = 400
const MAX_ALERTS = 150
const FLUSH_MS = 400
const RATE_WINDOW_MS = 5000

export interface LiveStreams {
  events: CepEvent[]
  alerts: EnrichedAlert[]
  /** null until the config fetch lands (or if Analytics is unreachable). */
  windowInfo: WindowInfo | null
  connected: boolean
  eventsPerSec: number
  totalEvents: number
  totalAlerts: number
  totalForecasts: number
}

export function useLiveStreams(): LiveStreams {
  const [events, setEvents] = React.useState<CepEvent[]>([])
  const [alerts, setAlerts] = React.useState<EnrichedAlert[]>([])
  const [windowInfo, setWindowInfo] = React.useState<WindowInfo | null>(null)
  const [connected, setConnected] = React.useState(false)
  const [eventsPerSec, setEventsPerSec] = React.useState(0)
  const [totals, setTotals] = React.useState({ events: 0, alerts: 0, forecasts: 0 })

  const pendingEvents = React.useRef<CepEvent[]>([])
  const pendingAlerts = React.useRef<EnrichedAlert[]>([])
  const arrivals = React.useRef<number[]>([])
  const totalsRef = React.useRef({ events: 0, alerts: 0, forecasts: 0 })

  React.useEffect(() => {
    let cancelled = false

    // Seed from REST so the dashboard isn't blank before the first socket flush.
    fetchEvents().then((e) => !cancelled && setEvents(e.slice(-MAX_EVENTS))).catch(() => {})
    fetchAlerts().then((a) => !cancelled && setAlerts(a.slice(-MAX_ALERTS))).catch(() => {})
    // One-shot: eKuiper's window config only changes with a restart of the stack.
    fetchWindow().then((w) => !cancelled && setWindowInfo(w)).catch(() => {})

    const socket = connectSocket()
    socket.on("connect", () => setConnected(true))
    socket.on("disconnect", () => setConnected(false))
    socket.on("event", (e: CepEvent) => {
      pendingEvents.current.push(e)
      arrivals.current.push(Date.now())
    })
    socket.on("alert", (a: EnrichedAlert) => pendingAlerts.current.push(a))

    const flush = window.setInterval(() => {
      const now = Date.now()
      arrivals.current = arrivals.current.filter((t) => now - t <= RATE_WINDOW_MS)
      setEventsPerSec(arrivals.current.length / (RATE_WINDOW_MS / 1000))

      if (pendingEvents.current.length) {
        const batch = pendingEvents.current
        pendingEvents.current = []
        totalsRef.current.events += batch.length
        setEvents((prev) => [...prev, ...batch].slice(-MAX_EVENTS))
      }
      if (pendingAlerts.current.length) {
        const batch = pendingAlerts.current
        pendingAlerts.current = []
        totalsRef.current.alerts += batch.length
        totalsRef.current.forecasts += batch.filter((a) => a.forecast_available).length
        setAlerts((prev) => [...prev, ...batch].slice(-MAX_ALERTS))
      }
      setTotals({ ...totalsRef.current })
    }, FLUSH_MS)

    return () => {
      cancelled = true
      window.clearInterval(flush)
      socket.close()
    }
  }, [])

  return {
    events,
    alerts,
    windowInfo,
    connected,
    eventsPerSec,
    totalEvents: totals.events,
    totalAlerts: totals.alerts,
    totalForecasts: totals.forecasts,
  }
}
