import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Logger } from '@nestjs/common';
import { DataSource, SensorReading } from './data-source';
import { DEVICE_PROFILES, PROFILE_INDEX_BY_MAC } from './device-profiles';

/**
 * Streams a sample of the real dataset CSV, bucketed by the three device
 * profiles. Each profile's bucket is replayed cyclically. The CSV is read once
 * at startup and capped at `sampleSize` rows per profile to bound memory/startup.
 *
 * CSV columns: "ts","device","co","humidity","light","lpg","motion","smoke","temp"
 */
export class ReplayDataSource implements DataSource {
  private readonly logger = new Logger(ReplayDataSource.name);
  private readonly buckets: SensorReading[][] = DEVICE_PROFILES.map(() => []);
  private readonly cursors: number[] = DEVICE_PROFILES.map(() => 0);

  constructor(
    private readonly datasetPath: string,
    private readonly sampleSize: number,
  ) {}

  async init(): Promise<void> {
    const stream = createReadStream(this.datasetPath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    let header = true;
    let read = 0;
    const cap = this.sampleSize;
    const full = () => this.buckets.every((b) => b.length >= cap);

    try {
      for await (const line of rl) {
        if (header) {
          header = false;
          continue;
        }
        if (!line) continue;
        const reading = parseRow(line);
        if (!reading) continue;
        const { profileIndex, value } = reading;
        if (this.buckets[profileIndex].length < cap) {
          this.buckets[profileIndex].push(value);
          read++;
        }
        if (full()) break;
      }
    } finally {
      rl.close();
      stream.destroy();
    }

    const counts = this.buckets.map((b, i) => `${DEVICE_PROFILES[i].label}=${b.length}`).join(' ');
    if (read === 0) {
      throw new Error(`ReplayDataSource: no usable rows read from ${this.datasetPath}`);
    }
    this.logger.log(`replay loaded ${read} rows from ${this.datasetPath} [${counts}]`);
  }

  profileCount(): number {
    return DEVICE_PROFILES.length;
  }

  profileId(profileIndex: number): string {
    return DEVICE_PROFILES[profileIndex % DEVICE_PROFILES.length].mac;
  }

  next(profileIndex: number): SensorReading {
    const p = profileIndex % DEVICE_PROFILES.length;
    const bucket = this.buckets[p];
    if (bucket.length === 0) {
      throw new Error(`ReplayDataSource: empty bucket for profile ${DEVICE_PROFILES[p].label}`);
    }
    const reading = bucket[this.cursors[p] % bucket.length];
    this.cursors[p] = (this.cursors[p] + 1) % bucket.length;
    return reading;
  }
}

/** Parse one CSV data line into a reading + its profile index, or null if device is unknown. */
function parseRow(line: string): { profileIndex: number; value: SensorReading } | null {
  const cols = line.split(',').map((c) => c.replace(/^"|"$/g, ''));
  if (cols.length < 9) return null;
  const [ts, device, co, humidity, light, lpg, motion, smoke, temp] = cols;
  const profileIndex = PROFILE_INDEX_BY_MAC.get(device);
  if (profileIndex === undefined) return null;
  return {
    profileIndex,
    value: {
      ts: Number(ts),
      co: Number(co),
      humidity: Number(humidity),
      light: light === 'true',
      lpg: Number(lpg),
      motion: motion === 'true',
      smoke: Number(smoke),
      temp: Number(temp),
    },
  };
}
