/**
 * Toast handlers for the manual "Trigger burst" button. Lives outside the
 * dashboard component so the orchestrator stays focused on layout and the
 * toaster strings remain a single point of edit.
 */
import { toast } from "sonner"

import { fmtRate } from "@/lib/format"
import type { BurstResult } from "@/lib/types"

export interface BurstHandlers {
  onSuccess: (result: BurstResult) => void
  onError: () => void
}

export function burstHandlers(): BurstHandlers {
  return {
    onSuccess: (r) =>
      toast.success("Burst triggered", {
        description: `${fmtRate(r.fromRatePerSec)} → ${fmtRate(r.toRatePerSec)} msg/s for ${r.durationSec}s`,
      }),
    onError: () =>
      toast.error("Burst failed", {
        description: "Is the ingestion service reachable?",
      }),
  }
}
