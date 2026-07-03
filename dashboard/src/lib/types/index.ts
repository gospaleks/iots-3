/**
 * Barrel for the three services' GET /stats response shapes plus the
 * client-side history Sample. Domain-split into per-service modules so each
 * stays close to the backend file it mirrors.
 */

export type { BurstResult, IngestionStats } from "./ingestion"
export type {
  SeqStats,
  StorageStats,
  TransportLatencyStats,
  WriteMode,
  WriterStats,
} from "./storage"
export type {
  AnalyticsStats,
  AnalyticsTransportLatency,
  EventToAlertLatency,
  WindowSummary,
} from "./analytics"
export type { Sample } from "./history"
