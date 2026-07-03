/**
 * Ingestion service client — GET /stats and POST /burst (Scenario C demo control).
 */
import type { BurstResult, IngestionStats } from "@/lib/types"
import { createServiceClient, INGESTION_URL } from "./client"

const ingestion = createServiceClient(INGESTION_URL)

export async function fetchIngestionStats(): Promise<IngestionStats> {
  const { data } = await ingestion.get<IngestionStats>("/stats")
  return data
}

export async function triggerBurst(durationSec: number): Promise<BurstResult> {
  const { data } = await ingestion.post<BurstResult>("/burst", null, {
    params: { durationSec },
  })
  return data
}
