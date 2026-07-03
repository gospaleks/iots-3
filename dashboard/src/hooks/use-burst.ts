import { useMutation } from "@tanstack/react-query"

import { triggerBurst } from "@/lib/api"

/** Fires POST /burst on the ingestion service (Scenario C demo control). */
export function useBurst() {
  return useMutation({
    mutationFn: (durationSec: number) => triggerBurst(durationSec),
  })
}
