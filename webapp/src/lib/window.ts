// Infer the eKuiper window shape from live WINDOW_METRICS events.
//
// Analytics doesn't know eKuiper's window config, but every WINDOW_METRICS event
// carries window_start/window_end (epoch ms). The window *width* is end - start;
// the *step* is the gap between consecutive window_starts. When step < width the
// windows overlap (hopping/sliding); otherwise they tile (tumbling). This lets the
// dashboard show the window mode changing live, without any extra backend wiring.
//
// Why a low percentile and not the median: eKuiper (2.2.1) occasionally misses a
// processing-time trigger and emits one merged window instead of two — with a 10s
// tumbling window you see a steady 10s/20s alternation. No data is lost, but a
// merged window is *twice* as wide, which would drag a median to 15s. Merging can
// only ever make a window longer than configured, so the low end of the observed
// distribution is the real setting. p25 also shrugs off the one short partial
// window every rule emits when it starts.
import type { CepEvent } from "./api"

export interface WindowInfo {
  widthSec: number | null
  stepSec: number | null
  overlapping: boolean
  label: string
}

/** 25th percentile — robust to merged (too long) and partial (too short) windows. */
function lowPercentile(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) * 0.25)]
}

export function deriveWindowInfo(events: CepEvent[]): WindowInfo {
  const windows = events.filter(
    (e) =>
      e.event_type === "WINDOW_METRICS" &&
      e.window_start != null &&
      e.window_end != null,
  )

  const widths = windows.map((e) => (e.window_end! - e.window_start!) / 1000)
  const width = lowPercentile(widths)

  // Distinct, sorted window starts → gaps between consecutive windows.
  const starts = Array.from(new Set(windows.map((e) => e.window_start!))).sort(
    (a, b) => a - b,
  )
  const gaps: number[] = []
  for (let i = 1; i < starts.length; i++) gaps.push((starts[i] - starts[i - 1]) / 1000)
  const step = lowPercentile(gaps)

  const overlapping = width != null && step != null && step < width - 0.5

  let label = "waiting…"
  if (width != null) {
    const w = Math.round(width)
    if (step != null && overlapping) label = `hopping · ${w}s / ${Math.round(step)}s`
    else label = `tumbling · ${w}s`
  }

  return { widthSec: width, stepSec: step, overlapping, label }
}
