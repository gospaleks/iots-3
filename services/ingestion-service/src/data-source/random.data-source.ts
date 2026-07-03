import { Logger } from '@nestjs/common';
import { DataSource, SensorReading } from './data-source';
import { DEVICE_PROFILES, DeviceProfile, Range } from './device-profiles';

/** Generates realistic random readings within each profile's dataset-derived ranges. */
export class RandomDataSource implements DataSource {
  private readonly logger = new Logger(RandomDataSource.name);

  async init(): Promise<void> {
    this.logger.log(`random data source ready (${DEVICE_PROFILES.length} profiles)`);
  }

  profileCount(): number {
    return DEVICE_PROFILES.length;
  }

  profileId(profileIndex: number): string {
    return DEVICE_PROFILES[profileIndex % DEVICE_PROFILES.length].mac;
  }

  next(profileIndex: number): SensorReading {
    const p: DeviceProfile = DEVICE_PROFILES[profileIndex % DEVICE_PROFILES.length];
    return {
      ts: Date.now() / 1000, // random mode has no real event time → use now
      co: rnd(p.co),
      humidity: rnd(p.humidity),
      light: Math.random() < p.lightProb,
      lpg: rnd(p.lpg),
      motion: Math.random() < p.motionProb,
      smoke: rnd(p.smoke),
      temp: rnd(p.temp),
    };
  }
}

function rnd(r: Range): number {
  return r.min + Math.random() * (r.max - r.min);
}
