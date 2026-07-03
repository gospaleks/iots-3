/**
 * Canonical broker payload. Mirrors shared/message-contract.md exactly.
 *
 * `ts` is the dataset EVENT time (epoch seconds); `sent_at_ms` is the
 * publisher's SEND time (epoch ms) and is the basis for latency metrics.
 * They are different on purpose — never conflate them.
 */
export interface SensorMessage {
  /** Dataset event time, epoch seconds. Stored as TIMESTAMPTZ. */
  ts: number;
  /** Source device MAC. */
  device: string;
  co: number;
  humidity: number;
  light: boolean;
  lpg: number;
  motion: boolean;
  smoke: number;
  temp: number;
  /** Per-device monotonic counter. Gaps ⇒ loss; repeats ⇒ duplicates. */
  seq: number;
  /** Wall-clock send time, epoch ms. Basis for latency (NOT `ts`). */
  sent_at_ms: number;
}
