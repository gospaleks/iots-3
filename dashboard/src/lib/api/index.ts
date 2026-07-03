/**
 * Public api barrel — preserves the original surface previously exported by
 * lib/api.ts so callers (hooks/*) keep working unchanged.
 */

export { ANALYTICS_URL, INGESTION_URL, STORAGE_URL, TIMEOUT_MS } from "./client"
export { fetchIngestionStats, triggerBurst } from "./ingestion"
export { fetchStorageStats } from "./storage"
export { fetchAnalyticsStats } from "./analytics"
