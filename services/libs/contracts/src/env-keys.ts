/**
 * Env-var keys shared across services so there are no stray string literals.
 * Values/semantics documented in docker/.env.example and REQUIREMENTS §5.
 */
export const ENV_KEYS = {
  BROKER_TYPE: 'BROKER_TYPE',
  BROKER_HOST: 'BROKER_HOST',
  BROKER_PORT: 'BROKER_PORT',
  TOPIC: 'TOPIC',
  CLIENT_ID: 'CLIENT_ID',
  // MQTT
  QOS_LEVEL: 'QOS_LEVEL',
  MQTT_CLEAN_SESSION: 'MQTT_CLEAN_SESSION',
  // MQTT keepalive (s). Low values let the broker detect a dead client fast (e.g. an
  // offline subscriber → clean vs persistent session behaviour).
  MQTT_KEEPALIVE_SEC: 'MQTT_KEEPALIVE_SEC',
} as const;

export type EnvKey = (typeof ENV_KEYS)[keyof typeof ENV_KEYS];
