import { ENV_KEYS, MQTT_TOPIC } from '@iots/contracts';

export const INGESTION_CONFIG = Symbol('INGESTION_CONFIG');

export type DataSourceKind = 'replay' | 'random';

/**
 * Resolved ingestion config. Rate semantics (documented in
 * docs/notes/03-ingestion-service.md):
 *   - `messagesPerSecond` is PER DEVICE → baseline total = numDevices × messagesPerSecond.
 *   - `burstTargetRate` is a TOTAL fleet rate the simulator jumps to during a burst.
 */
export interface IngestionConfig {
  numDevices: number;
  messagesPerSecond: number;
  burstTargetRate: number;
  topic: string;
  dataSource: DataSourceKind;
  datasetPath: string;
  replaySampleSize: number;
  port: number;
}

function int(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadIngestionConfig(env: NodeJS.ProcessEnv = process.env): IngestionConfig {
  const dataSource = (env.DATA_SOURCE ?? 'replay') as DataSourceKind;
  if (dataSource !== 'replay' && dataSource !== 'random') {
    throw new Error(`Invalid DATA_SOURCE "${dataSource}" (expected "replay" | "random")`);
  }
  return {
    numDevices: int(env.NUM_DEVICES, 100),
    messagesPerSecond: int(env.MESSAGES_PER_SECOND, 10),
    burstTargetRate: int(env.BURST_TARGET_RATE, 5000),
    topic: env[ENV_KEYS.TOPIC] ?? MQTT_TOPIC,
    dataSource,
    datasetPath: env.DATASET_PATH ?? '/data/iot_telemetry_data.csv',
    replaySampleSize: int(env.REPLAY_SAMPLE_SIZE, 10_000),
    port: int(env.INGESTION_PORT, 3001),
  };
}
