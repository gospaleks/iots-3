/**
 * Rolling history sample shape used by the throughput + latency charts.
 * One point is appended per poll tick by the client-side sampler.
 */

export interface Sample {
  t: number
  label: string
  /** ingestion currentRatePerSec (msg/s, reported by the simulator). */
  publishRate: number
  /** derived: Δ stored / Δt between consecutive samples (msg/s). */
  storedRate: number
  /** derived: incremental transport latency over the last interval (ms), or null until known. */
  transportMs: number | null
}
