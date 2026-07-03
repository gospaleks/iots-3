import { SensorMessage } from '@iots/contracts';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StorageConfig, STORAGE_CONFIG } from '../config/storage.config';

const COLUMNS = ['ts', 'device', 'co', 'humidity', 'light', 'lpg', 'motion', 'smoke', 'temp', 'seq', 'sent_at_ms'];

export interface WriterStats {
  writeMode: string;
  received: number;
  stored: number; // rows actually inserted (DB-confirmed)
  conflicts: number; // duplicate (ts, device) skipped via ON CONFLICT DO NOTHING
  flushes: number;
  errors: number;
  buffered: number;
  lastFlushSize: number;
}

/**
 * The only writer to TimescaleDB. DIRECT = one insert per message (dev); BATCH =
 * buffer and flush on BATCH_SIZE OR FLUSH_INTERVAL_MS (whichever first), single
 * multi-row INSERT per flush. Inserts use `ON CONFLICT (ts, device) DO NOTHING`
 * with `RETURNING 1` so we get the exact inserted count (and thus the conflict
 * count) — replay can legitimately re-emit a `(ts, device)` pair.
 */
@Injectable()
export class SensorWriterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SensorWriterService.name);
  private buffer: SensorMessage[] = [];
  private flushTimer?: NodeJS.Timeout;

  private received = 0;
  private stored = 0;
  private conflicts = 0;
  private flushes = 0;
  private errors = 0;
  private lastFlushSize = 0;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @Inject(STORAGE_CONFIG) private readonly cfg: StorageConfig,
  ) {}

  onModuleInit(): void {
    if (this.cfg.writeMode === 'BATCH') {
      // Mandatory time-based flush — prevents low-rate stalls (DECISIONS §7.5).
      this.flushTimer = setInterval(() => void this.flush(), this.cfg.flushIntervalMs);
      this.logger.log(`BATCH mode: size=${this.cfg.batchSize} flushInterval=${this.cfg.flushIntervalMs}ms`);
    } else {
      this.logger.log('DIRECT mode: one insert per message');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush(); // drain remaining buffer on shutdown
  }

  accept(message: SensorMessage): void {
    this.received++;
    if (this.cfg.writeMode === 'DIRECT') {
      void this.insert([message]);
      return;
    }
    this.buffer.push(message);
    if (this.buffer.length >= this.cfg.batchSize) {
      void this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const rows = this.buffer.splice(0, this.buffer.length); // atomic in single-threaded JS
    this.flushes++;
    this.lastFlushSize = rows.length;
    await this.insert(rows);
  }

  private async insert(rows: SensorMessage[]): Promise<void> {
    const { sql, params } = buildInsert(rows);
    try {
      const result = await this.ds.query(sql, params);
      const inserted = Array.isArray(result) ? result.length : 0;
      this.stored += inserted;
      this.conflicts += rows.length - inserted;
    } catch (err) {
      this.errors += rows.length;
      if (this.errors <= rows.length || this.errors % 1000 < rows.length) {
        this.logger.error(`insert of ${rows.length} rows failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  stats(): WriterStats {
    return {
      writeMode: this.cfg.writeMode,
      received: this.received,
      stored: this.stored,
      conflicts: this.conflicts,
      flushes: this.flushes,
      errors: this.errors,
      buffered: this.buffer.length,
      lastFlushSize: this.lastFlushSize,
    };
  }
}

/** Build a parameterized multi-row INSERT. `ts` (epoch seconds) → TIMESTAMPTZ via to_timestamp(). */
function buildInsert(rows: SensorMessage[]): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const tuples = rows.map((r) => {
    const b = params.length;
    params.push(r.ts, r.device, r.co, r.humidity, r.light, r.lpg, r.motion, r.smoke, r.temp, r.seq, r.sent_at_ms);
    return `(to_timestamp($${b + 1}), $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11})`;
  });
  const sql =
    `INSERT INTO sensor_data (${COLUMNS.join(', ')}) VALUES ${tuples.join(', ')} ` +
    `ON CONFLICT (ts, device) DO NOTHING RETURNING 1`;
  return { sql, params };
}
