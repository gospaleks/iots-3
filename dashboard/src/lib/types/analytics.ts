/**
 * Analytics service /stats response shape.
 * Mirrors analytics-service app/metrics.py (snapshot) + app/main.py (/stats).
 */

export interface WindowSummary {
  start_iso: string
  end_iso: string
  count: number
  avg_temp: number
  avg_humidity: number
  avg_co: number
  alert: boolean
  event_to_alert_avg_ms: number
  event_to_alert_max_ms: number
}

export interface AnalyticsTransportLatency {
  count: number
  avg: number
  max: number
}

export interface EventToAlertLatency {
  windows: number
  avg: number
  max: number
}

export interface AnalyticsStats {
  broker: string
  windowSizeSec: number
  alertThreshold: number
  messages: number
  windows: number
  alerts: number
  transportLatencyMs: AnalyticsTransportLatency
  eventToAlertLatencyMs: EventToAlertLatency
  lastWindow: WindowSummary | null
}
