/**
 * Single source of truth for the dashboard's live data — thin composition over
 * three `useServiceStats` queries and the rolling-history sampler. Public
 * surface (return shape: ingestion/storage/analytics/status/history) is
 * preserved from the previous monolithic implementation.
 */
import {
  fetchAnalyticsStats,
  fetchIngestionStats,
  fetchStorageStats,
} from "@/lib/api"
import { useRollingHistory } from "./use-rolling-history"
import { useServiceStats, type ServiceStatus } from "./use-service-stats"

export type { ServiceStatus } from "./use-service-stats"

export interface DashboardStatusBag {
  ingestion: ServiceStatus
  storage: ServiceStatus
  analytics: ServiceStatus
}

export function useDashboardData(pollMs: number) {
  const ingestion = useServiceStats(
    ["ingestion-stats"],
    fetchIngestionStats,
    pollMs
  )
  const storage = useServiceStats(["storage-stats"], fetchStorageStats, pollMs)
  const analytics = useServiceStats(
    ["analytics-stats"],
    fetchAnalyticsStats,
    pollMs
  )

  const history = useRollingHistory(ingestion.data, storage.data, pollMs)

  const status: DashboardStatusBag = {
    ingestion: ingestion.status,
    storage: storage.status,
    analytics: analytics.status,
  }

  return {
    ingestion: ingestion.data,
    storage: storage.data,
    analytics: analytics.data,
    status,
    history,
  }
}
