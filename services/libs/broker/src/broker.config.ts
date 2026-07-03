import { ENV_KEYS, MQTT_TOPIC } from '@iots/contracts';
import { BrokerType } from './broker-adapter';

/** Resolved, broker-neutral config. QoS lives here but is consumed only by the adapter. */
export interface BrokerConfig {
  type: BrokerType;
  host: string;
  port: number;
  topic: string;
  clientId: string;
  /** MQTT QoS (0|1|2). */
  qos: 0 | 1 | 2;
  /** MQTT persistent session — set clean:false for an offline subscriber to buffer. */
  cleanSession: boolean;
  /** MQTT keepalive in seconds (broker declares a client dead after ~1.5×). */
  keepaliveSec: number;
}

/** Build a BrokerConfig from the environment. Defaults match docker/.env.example. */
export function loadBrokerConfig(env: NodeJS.ProcessEnv = process.env): BrokerConfig {
  const type = (env[ENV_KEYS.BROKER_TYPE] ?? 'mqtt') as BrokerType;
  if (type !== 'mqtt') {
    throw new Error(`Invalid ${ENV_KEYS.BROKER_TYPE} "${type}" (expected "mqtt")`);
  }

  return {
    type,
    host: env[ENV_KEYS.BROKER_HOST] ?? 'mosquitto',
    port: Number(env[ENV_KEYS.BROKER_PORT] ?? 1883),
    topic: env[ENV_KEYS.TOPIC] ?? MQTT_TOPIC,
    // Unique by default: in containers process.pid is always 1, so two services would
    // otherwise share a clientId and an MQTT broker evicts the older same-id connection.
    // Set CLIENT_ID explicitly for a stable id (e.g. an MQTT persistent session).
    clientId:
      env[ENV_KEYS.CLIENT_ID] ??
      `iots-${type}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
    qos: Number(env[ENV_KEYS.QOS_LEVEL] ?? 1) as 0 | 1 | 2,
    cleanSession: (env[ENV_KEYS.MQTT_CLEAN_SESSION] ?? 'true') !== 'false',
    keepaliveSec: Number(env[ENV_KEYS.MQTT_KEEPALIVE_SEC] ?? 60),
  };
}
