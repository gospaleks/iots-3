import { BROKER_ADAPTER, ReceivedMeta, SubscriberAdapter } from '@iots/broker';
import { SensorMessage } from '@iots/contracts';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { StorageConfig, STORAGE_CONFIG } from '../config/storage.config';
import { SeqTracker, SeqStats } from './seq-tracker';
import { SensorWriterService } from './sensor-writer.service';

export interface TransportLatencyStats {
  count: number;
  avgMs: number;
  maxMs: number;
}

export interface SubscriberStats {
  seq: SeqStats;
  transportLatencyMs: TransportLatencyStats;
}

/**
 * Subscribes to the broker (via the injected adapter) and feeds each message to
 * the writer, while tracking per-device seq integrity and transport latency
 * (`receivedAtMs − sent_at_ms`).
 */
@Injectable()
export class SubscriberService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubscriberService.name);
  private readonly seq = new SeqTracker();
  private latCount = 0;
  private latSum = 0;
  private latMax = 0;

  constructor(
    @Inject(BROKER_ADAPTER) private readonly adapter: SubscriberAdapter,
    @Inject(STORAGE_CONFIG) private readonly cfg: StorageConfig,
    private readonly writer: SensorWriterService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.adapter.connect();
    await this.adapter.subscribe(this.cfg.topic, (message, meta) => this.onMessage(message, meta));
    this.logger.log(`subscribed to "${this.cfg.topic}"`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.adapter.disconnect();
  }

  private onMessage(message: SensorMessage, meta: ReceivedMeta): void {
    this.seq.observe(message.device, message.seq);
    const latency = meta.receivedAtMs - message.sent_at_ms;
    this.latCount++;
    this.latSum += latency;
    if (latency > this.latMax) this.latMax = latency;
    this.writer.accept(message);
  }

  stats(): SubscriberStats {
    return {
      seq: this.seq.stats(),
      transportLatencyMs: {
        count: this.latCount,
        avgMs: this.latCount ? Math.round((this.latSum / this.latCount) * 100) / 100 : 0,
        maxMs: this.latMax,
      },
    };
  }
}
