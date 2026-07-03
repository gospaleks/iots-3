/**
 * Ingestion service /stats and /burst response shapes.
 * Mirrors ingestion-service/src/simulator/simulator.service.ts (getStats)
 * and ingestion-service/src/control/control.controller.ts (POST /burst).
 */

export interface IngestionStats {
  running: boolean
  bursting: boolean
  numDevices: number
  baselineRatePerSec: number
  currentRatePerSec: number
  published: number
  errors: number
  inFlight: number
  uptimeMs: number
}

export interface BurstResult {
  fromRatePerSec: number
  toRatePerSec: number
  durationSec: number
}
