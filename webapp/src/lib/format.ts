// Small display formatters shared across the dashboard.

/** eKuiper windowed events use epoch-ms; HIGH_CO / alert `ts` is float seconds. */
export function toMillis(ts: number | null | undefined): number | null {
  if (ts == null) return null
  // Anything below year-2001 in ms is really a seconds timestamp.
  return ts < 1e12 ? ts * 1000 : ts
}

export function formatClock(ms: number | null): string {
  if (ms == null) return "—"
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function formatTemp(v: number | null | undefined): string {
  return v == null ? "—" : `${v.toFixed(1)}°C`
}

export function formatCo(v: number | null | undefined): string {
  return v == null ? "—" : v.toFixed(4)
}

export function formatSignedDelta(v: number | null | undefined): string {
  if (v == null) return "—"
  const sign = v > 0 ? "+" : ""
  return `${sign}${v.toFixed(1)}°C`
}
