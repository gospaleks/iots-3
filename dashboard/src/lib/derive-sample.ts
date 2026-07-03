/**
 * Pure helper that turns the latest /stats snapshot (plus the previous one)
 * into a chart `Sample`. Keeps the Δstored/Δt + Δ(avg·count)/Δcount aritmethic
 * out of the React layer so it can be unit-reasoned about independently.
 */
import type { IngestionStats, Sample, StorageStats } from "@/lib/types"

export interface PrevSample {
  stored: number
  transportCount: number
  transportSum: number
  t: number
}

export interface DeriveResult {
  sample: Sample
  next: PrevSample | null
}

function buildLabel(now: number): string {
  return new Date(now).toLocaleTimeString("en-US", { hour12: false })
}

export function deriveSample(
  prev: PrevSample | null,
  ingestion: IngestionStats | undefined,
  storage: StorageStats | undefined,
  now: number
): DeriveResult {
  let storedRate = 0
  let transportMs: number | null = storage
    ? storage.transportLatencyMs.avgMs
    : null
  let next: PrevSample | null = prev

  if (storage) {
    const transportSum =
      storage.transportLatencyMs.avgMs * storage.transportLatencyMs.count

    if (prev) {
      const dt = (now - prev.t) / 1000
      if (dt > 0) {
        storedRate = Math.max(0, (storage.writer.stored - prev.stored) / dt)
      }
      const dCount = storage.transportLatencyMs.count - prev.transportCount
      const dSum = transportSum - prev.transportSum
      if (dCount > 0) transportMs = dSum / dCount
    }

    next = {
      stored: storage.writer.stored,
      transportCount: storage.transportLatencyMs.count,
      transportSum,
      t: now,
    }
  }

  const sample: Sample = {
    t: now,
    label: buildLabel(now),
    publishRate: ingestion?.currentRatePerSec ?? 0,
    storedRate,
    transportMs,
  }

  return { sample, next }
}
