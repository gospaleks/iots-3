import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadBrokerConfig } from './broker.config';
import { createBrokerAdapter } from './broker.module';
import { KafkaAdapter } from './kafka.adapter';
import { MqttAdapter } from './mqtt.adapter';

test('factory returns MqttAdapter for BROKER_TYPE=mqtt', () => {
  const config = loadBrokerConfig({ BROKER_TYPE: 'mqtt' });
  assert.ok(createBrokerAdapter(config) instanceof MqttAdapter);
});

test('factory returns KafkaAdapter for BROKER_TYPE=kafka', () => {
  const config = loadBrokerConfig({ BROKER_TYPE: 'kafka' });
  assert.ok(createBrokerAdapter(config) instanceof KafkaAdapter);
});

test('loadBrokerConfig rejects an unknown BROKER_TYPE', () => {
  assert.throws(() => loadBrokerConfig({ BROKER_TYPE: 'rabbitmq' }));
});

test('config defaults differ per broker (host/port/topic)', () => {
  const mqtt = loadBrokerConfig({ BROKER_TYPE: 'mqtt' });
  assert.equal(mqtt.host, 'mosquitto');
  assert.equal(mqtt.port, 1883);
  assert.equal(mqtt.topic, 'sensors/telemetry');

  const kafka = loadBrokerConfig({ BROKER_TYPE: 'kafka' });
  assert.equal(kafka.host, 'kafka');
  assert.equal(kafka.port, 9092);
  assert.equal(kafka.topic, 'sensor-telemetry');
});

test('KAFKA_ACKS="all" normalizes to -1', () => {
  assert.equal(loadBrokerConfig({ BROKER_TYPE: 'kafka', KAFKA_ACKS: 'all' }).acks, -1);
  assert.equal(loadBrokerConfig({ BROKER_TYPE: 'kafka', KAFKA_ACKS: '0' }).acks, 0);
});
