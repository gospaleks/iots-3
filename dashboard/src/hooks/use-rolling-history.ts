/**
 * Maintains the rolling Sample buffer that feeds the throughput + latency
 * charts. The sampler runs on a fixed clock (setInterval at pollMs) and reads
 * the freshest service stats via a ref synced after render — chart points stay
 * evenly spaced regardless of per-query fetch jitter.
 *
 * The Δstored/Δt + Δ(avg·count)/Δcount arithmetic lives in
 * `lib/derive-sample.ts` so this hook stays focused on lifecycle + buffering.
 */
import { useEffect, useRef, useState } from "react"

import { HISTORY_CAPACITY } from "@/lib/constants"
import { deriveSample, type PrevSample } from "@/lib/derive-sample"
import type { IngestionStats, Sample, StorageStats } from "@/lib/types"

interface LatestRef {
  ingestion?: IngestionStats
  storage?: StorageStats
}

function appendBounded(buffer: Sample[], next: Sample): Sample[] {
  const trimmed =
    buffer.length >= HISTORY_CAPACITY
      ? buffer.slice(buffer.length - HISTORY_CAPACITY + 1)
      : buffer.slice()
  trimmed.push(next)
  return trimmed
}

export function useRollingHistory(
  ingestion: IngestionStats | undefined,
  storage: StorageStats | undefined,
  pollMs: number
): Sample[] {
  const latest = useRef<LatestRef>({})
  useEffect(() => {
    latest.current = { ingestion, storage }
  }, [ingestion, storage])

  const [history, setHistory] = useState<Sample[]>([])
  const prev = useRef<PrevSample | null>(null)

  useEffect(() => {
    const id = setInterval(() => {
      const snapshot = latest.current
      const now = Date.now()
      const { sample, next } = deriveSample(
        prev.current,
        snapshot.ingestion,
        snapshot.storage,
        now
      )
      prev.current = next
      setHistory((cur) => appendBounded(cur, sample))
    }, pollMs)

    return () => clearInterval(id)
  }, [pollMs])

  return history
}
