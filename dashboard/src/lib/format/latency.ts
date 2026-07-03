/** Latency-specific formatter (auto-switches ms → s above 1000ms). */
import { EM_DASH, isNum } from "./shared"

/** Latency: ms with 1 decimal, or seconds with 2 decimals above 1000ms. */
export function fmtMs(n: number | null | undefined): string {
  if (!isNum(n)) return EM_DASH
  return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n.toFixed(1)} ms`
}
