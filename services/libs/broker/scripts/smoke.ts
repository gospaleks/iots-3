/**
 * Integration smoke test — connects the env-selected adapter to a RUNNING broker
 * (Iteration 1 stack) and round-trips one message through publish → subscribe.
 *
 * From the WSL host (brokers reachable on localhost):
 *   MQTT : BROKER_TYPE=mqtt  BROKER_HOST=localhost BROKER_PORT=1883  npm run smoke -w @iots/broker
 *   Kafka: BROKER_TYPE=kafka BROKER_HOST=localhost BROKER_PORT=29092 npm run smoke -w @iots/broker
 *
 * Exits 0 on a verified round-trip, 1 on timeout/error.
 */
import { SensorMessage } from '@iots/contracts';
import { loadBrokerConfig } from '../src/broker.config';
import { createBrokerAdapter } from '../src/broker.module';

const ROUND_TRIP_TIMEOUT_MS = 15_000;

async function main(): Promise<void> {
  const config = loadBrokerConfig();
  console.log(`[smoke] broker=${config.type} endpoint=${config.host}:${config.port} topic=${config.topic}`);

  const adapter = createBrokerAdapter(config);
  await adapter.connect();

  // Unique seq so we only react to our own message (ignore broker leftovers).
  const probeSeq = Date.now();
  let received = false;

  const build = (): SensorMessage => ({
    ts: Date.now() / 1000,
    device: 'smoke-device',
    co: 0, humidity: 0, light: false, lpg: 0, motion: false, smoke: 0, temp: 0,
    seq: probeSeq,
    sent_at_ms: Date.now(),
  });

  // Prime the topic so the consumer never subscribes to a missing topic-partition
  // (Kafka auto-creates on first produce; harmless for MQTT).
  await adapter.publish(config.topic, build());

  const roundTrip = new Promise<void>((resolve) => {
    void adapter.subscribe(config.topic, (msg: SensorMessage, meta) => {
      if (msg.seq !== probeSeq) return;
      received = true;
      console.log(`[smoke] ✓ round-trip OK — transport latency ${meta.receivedAtMs - msg.sent_at_ms}ms`);
      resolve();
    }).catch((err) => console.error(`[smoke] subscribe error: ${err instanceof Error ? err.message : err}`));
  });

  // Give the consumer time to join the group / subscription before publishing.
  await delay(config.type === 'kafka' ? 4000 : 500);

  // Re-publish periodically to dodge subscription/rebalance races.
  const publisher = setInterval(() => void adapter.publish(config.topic, build()), 750);

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`no round-trip within ${ROUND_TRIP_TIMEOUT_MS}ms`)), ROUND_TRIP_TIMEOUT_MS),
  );

  try {
    await Promise.race([roundTrip, timeout]);
  } finally {
    clearInterval(publisher);
    await adapter.disconnect();
  }

  process.exit(received ? 0 : 1);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(`[smoke] ✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
