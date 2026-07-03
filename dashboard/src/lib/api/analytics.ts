/**
 * Analytics service client — GET /stats.
 */
import type { AnalyticsStats } from "@/lib/types"
import { createServiceClient, ANALYTICS_URL } from "./client"

const analytics = createServiceClient(ANALYTICS_URL)

export async function fetchAnalyticsStats(): Promise<AnalyticsStats> {
  const { data } = await analytics.get<AnalyticsStats>("/stats")
  return data
}
