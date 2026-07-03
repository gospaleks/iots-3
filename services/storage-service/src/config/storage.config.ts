import { ENV_KEYS, KAFKA_TOPIC, MQTT_TOPIC } from '@iots/contracts';

export const STORAGE_CONFIG = Symbol('STORAGE_CONFIG');

export type WriteMode = 'DIRECT' | 'BATCH';

/**
 * Resolved storage config. Batch flush fires on size OR time (DECISIONS §7.5) —
 * the time trigger is mandatory so low-rate streams don't stall un-flushed and
 * loss-on-crash stays bounded.
 */
export interface StorageConfig {
  databaseUrl: string;
  topic: string;
  writeMode: WriteMode;
  batchSize: number;
  flushIntervalMs: number;
  port: number;
}

function int(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const brokerType = env[ENV_KEYS.BROKER_TYPE] ?? 'mqtt';
  const defaultTopic = brokerType === 'kafka' ? KAFKA_TOPIC : MQTT_TOPIC;

  const writeMode = (env.WRITE_MODE ?? 'DIRECT').toUpperCase() as WriteMode;
  if (writeMode !== 'DIRECT' && writeMode !== 'BATCH') {
    throw new Error(`Invalid WRITE_MODE "${env.WRITE_MODE}" (expected "DIRECT" | "BATCH")`);
  }

  return {
    databaseUrl: env.DATABASE_URL ?? 'postgresql://iot:iot@timescaledb:5432/iotdb',
    topic: env[ENV_KEYS.TOPIC] ?? defaultTopic,
    writeMode,
    batchSize: int(env.BATCH_SIZE, 500),
    flushIntervalMs: int(env.FLUSH_INTERVAL_MS, 1000),
    port: int(env.STORAGE_PORT, 3002),
  };
}
