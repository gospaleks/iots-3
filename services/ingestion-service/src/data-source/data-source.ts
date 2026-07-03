/** One sensor reading (event-time + values), broker-neutral. `seq`/`sent_at_ms` are added at publish time. */
export interface SensorReading {
  ts: number; // epoch seconds (event time)
  co: number;
  humidity: number;
  light: boolean;
  lpg: number;
  motion: boolean;
  smoke: number;
  temp: number;
}

/**
 * A source of readings, one stream per device profile. `replay` cycles sampled
 * CSV rows; `random` synthesises values within each profile's ranges.
 */
export interface DataSource {
  /** Load/prepare (e.g. read the CSV). Called once at startup. */
  init(): Promise<void>;
  /** Number of available profiles (mapped to devices round-robin). */
  profileCount(): number;
  /** Base device id for a profile (real MAC). */
  profileId(profileIndex: number): string;
  /** Next reading for a given profile. */
  next(profileIndex: number): SensorReading;
}

export const DATA_SOURCE = Symbol('DATA_SOURCE');
