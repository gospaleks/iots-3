/** Numeric formatters (counts, rates, fixed-decimal readings). */
import { EM_DASH, isNum } from "./shared"

/** Whole number with thousands separators. */
export function fmtInt(n: number | null | undefined): string {
  if (!isNum(n)) return EM_DASH
  return Math.round(n).toLocaleString("en-US")
}

/** Rate: 1 decimal under 100, whole + separators above. */
export function fmtRate(n: number | null | undefined): string {
  if (!isNum(n)) return EM_DASH
  return n >= 100 ? Math.round(n).toLocaleString("en-US") : n.toFixed(1)
}

/** Sensor reading with one decimal (configurable digits). */
export function fmtFixed(n: number | null | undefined, digits = 1): string {
  if (!isNum(n)) return EM_DASH
  return n.toFixed(digits)
}
