import { BROKER_ADAPTER, PublisherAdapter } from '@iots/broker';
import { SensorMessage } from '@iots/contracts';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { IngestionConfig, INGESTION_CONFIG } from '../config/ingestion.config';
import { DATA_SOURCE, DataSource } from '../data-source/data-source';
import { buildDevices, SimDevice } from './device';

/** Scheduler granularity. Each tick publishes (rate × TICK_MS/1000) messages. */
const TICK_MS = 100;

export interface SimulatorStats {
  running: boolean;
  bursting: boolean;
  numDevices: number;
  baselineRatePerSec: number;
  currentRatePerSec: number;
  published: number;
  errors: number;
  inFlight: number;
  uptimeMs: number;
}

export interface BurstResult {
  fromRatePerSec: number;
  toRatePerSec: number;
  durationSec: number;
}

/**
 * Broker-agnostic device simulator — the system's only publisher. Drives a TOTAL
 * fleet rate (baseline = numDevices × messagesPerSecond) via a fixed-interval
 * scheduler, round-robining across devices so each device's `seq` increments in
 * order. Burst mode jumps the total rate to `burstTargetRate` for a fixed window.
 */
@Injectable()
export class SimulatorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SimulatorService.name);
  private readonly baselineRate: number;

  private devices: SimDevice[] = [];
  private cursor = 0;
  private accumulator = 0;
  private currentRate: number;
  private inFlight = 0;
  private published = 0;
  private errors = 0;
  private startedAt = 0;
  private bursting = false;

  private tickHandle?: NodeJS.Timeout;
  private burstHandle?: NodeJS.Timeout;

  constructor(
    @Inject(BROKER_ADAPTER) private readonly publisher: PublisherAdapter,
    @Inject(INGESTION_CONFIG) private readonly cfg: IngestionConfig,
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
  ) {
    this.baselineRate = cfg.numDevices * cfg.messagesPerSecond;
    this.currentRate = this.baselineRate;
  }

  async onModuleInit(): Promise<void> {
    await this.dataSource.init();
    this.devices = buildDevices(this.cfg.numDevices, this.dataSource);
    await this.publisher.connect();

    this.startedAt = Date.now();
    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
    this.logger.log(
      `simulator started: ${this.devices.length} devices, baseline ${this.baselineRate} msg/s ` +
        `(${this.cfg.messagesPerSecond}/device), source=${this.cfg.dataSource}, topic=${this.cfg.topic}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.tickHandle) clearInterval(this.tickHandle);
    if (this.burstHandle) clearTimeout(this.burstHandle);
    await this.publisher.disconnect();
    this.logger.log(`simulator stopped: published=${this.published} errors=${this.errors}`);
  }

  /** Jump the total fleet rate to the burst target for `durationSec`, then revert (Scenario C). */
  triggerBurst(durationSec: number): BurstResult {
    if (this.burstHandle) clearTimeout(this.burstHandle);
    this.currentRate = this.cfg.burstTargetRate;
    this.bursting = true;
    this.logger.warn(`BURST → ${this.currentRate} msg/s for ${durationSec}s`);
    this.burstHandle = setTimeout(() => {
      this.currentRate = this.baselineRate;
      this.bursting = false;
      this.burstHandle = undefined;
      this.logger.log(`burst ended → back to baseline ${this.baselineRate} msg/s`);
    }, durationSec * 1000);
    return { fromRatePerSec: this.baselineRate, toRatePerSec: this.currentRate, durationSec };
  }

  stats(): SimulatorStats {
    return {
      running: this.tickHandle !== undefined,
      bursting: this.bursting,
      numDevices: this.devices.length,
      baselineRatePerSec: this.baselineRate,
      currentRatePerSec: this.currentRate,
      published: this.published,
      errors: this.errors,
      inFlight: this.inFlight,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
    };
  }

  private tick(): void {
    this.accumulator += (this.currentRate * TICK_MS) / 1000;
    let n = Math.floor(this.accumulator);
    this.accumulator -= n;

    while (n-- > 0) {
      const device = this.devices[this.cursor];
      this.cursor = (this.cursor + 1) % this.devices.length;
      this.publishOne(device);
    }
  }

  private publishOne(device: SimDevice): void {
    const message = this.build(device);
    this.inFlight++;
    this.publisher
      .publish(this.cfg.topic, message)
      .then(() => {
        this.published++;
      })
      .catch((err) => {
        this.errors++;
        if (this.errors % 1000 === 1) {
          this.logger.error(`publish failed (${this.errors} total): ${err instanceof Error ? err.message : err}`);
        }
      })
      .finally(() => {
        this.inFlight--;
      });
  }

  private build(device: SimDevice): SensorMessage {
    const r = this.dataSource.next(device.profileIndex);
    device.seq += 1;
    return {
      ts: r.ts,
      device: device.id,
      co: r.co,
      humidity: r.humidity,
      light: r.light,
      lpg: r.lpg,
      motion: r.motion,
      smoke: r.smoke,
      temp: r.temp,
      seq: device.seq,
      sent_at_ms: Date.now(),
    };
  }
}
