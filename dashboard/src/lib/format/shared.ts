/** Shared primitives for the formatter family. */

export const EM_DASH = "—"

export function isNum(n: number | null | undefined): n is number {
  return n != null && !Number.isNaN(n)
}
