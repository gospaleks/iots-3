import { ENV_KEYS, KAFKA_TOPIC, MQTT_TOPIC } from '@iots/contracts';
import { BrokerType } from './broker-adapter';

/** Resolved, broker-neutral config. QoS/acks live here but are consumed only by the matching adapter. */
export interface BrokerConfig {
  type: BrokerType;
  host: string;
  port: number;
  topic: string;
  clientId: string;
  /** MQTT QoS (0|1|2). */
  qos: 0 | 1 | 2;
  /** MQTT persistent session — set false-flag for Scenario B (offline buffering). */
  cleanSession: boolean;
  /** MQTT keepalive in seconds (broker declares a client dead after ~1.5×). */
  keepaliveSec: number;
  /** Kafka producer acks, normalized to kafkajs numeric form: 0 | 1 | -1 (all). */
  acks: number;
  /** Kafka consumer group id (storage = one group, analytics = another). */
  groupId: string;
}

function parseAcks(raw: string | undefined): number {
  if (raw === 'all') return -1;
  const n = Number(raw ?? 1);
  return Number.isNaN(n) ? 1 : n;
}

/** Build a BrokerConfig from the environment. Defaults match docker/.env.example. */
export function loadBrokerConfig(env: NodeJS.ProcessEnv = process.env): BrokerConfig {
  const type = (env[ENV_KEYS.BROKER_TYPE] ?? 'mqtt') as BrokerType;
  if (type !== 'mqtt' && type !== 'kafka') {
    throw new Error(`Invalid ${ENV_KEYS.BROKER_TYPE} "${type}" (expected "mqtt" | "kafka")`);
  }

  const isMqtt = type === 'mqtt';
  return {
    type,
    host: env[ENV_KEYS.BROKER_HOST] ?? (isMqtt ? 'mosquitto' : 'kafka'),
    port: Number(env[ENV_KEYS.BROKER_PORT] ?? (isMqtt ? 1883 : 9092)),
    topic: env[ENV_KEYS.TOPIC] ?? (isMqtt ? MQTT_TOPIC : KAFKA_TOPIC),
    // Unique by default: in containers process.pid is always 1, so two services would
    // otherwise share a clientId and an MQTT broker evicts the older same-id connection.
    // Set CLIENT_ID explicitly for a stable id (e.g. MQTT persistent sessions, Scenario B).
    clientId:
      env[ENV_KEYS.CLIENT_ID] ??
      `iots-${type}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
    qos: Number(env[ENV_KEYS.QOS_LEVEL] ?? 1) as 0 | 1 | 2,
    cleanSession: (env[ENV_KEYS.MQTT_CLEAN_SESSION] ?? 'true') !== 'false',
    keepaliveSec: Number(env[ENV_KEYS.MQTT_KEEPALIVE_SEC] ?? 60),
    acks: parseAcks(env[ENV_KEYS.KAFKA_ACKS]),
    groupId: env[ENV_KEYS.KAFKA_GROUP_ID] ?? 'iots-storage',
  };
}
