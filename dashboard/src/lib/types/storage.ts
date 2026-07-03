/**
 * Storage service /stats response shape.
 * Mirrors storage-service src/storage/{sensor-writer,seq-tracker,subscriber}.
 */

export type WriteMode = "DIRECT" | "BATCH"

export interface WriterStats {
  writeMode: WriteMode
  received: number
  stored: number
  conflicts: number
  flushes: number
  errors: number
  buffered: number
  lastFlushSize: number
}

export interface SeqStats {
  devices: number
  received: number
  missing: number
  gaps: number
  duplicates: number
  outOfOrder: number
}

export interface TransportLatencyStats {
  count: number
  avgMs: number
  maxMs: number
}

export interface StorageStats {
  writer: WriterStats
  seq: SeqStats
  transportLatencyMs: TransportLatencyStats
}
