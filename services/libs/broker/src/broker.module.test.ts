import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadBrokerConfig } from './broker.config';
import { createBrokerAdapter } from './broker.module';
import { MqttAdapter } from './mqtt.adapter';

test('factory returns MqttAdapter for BROKER_TYPE=mqtt', () => {
  const config = loadBrokerConfig({ BROKER_TYPE: 'mqtt' });
  assert.ok(createBrokerAdapter(config) instanceof MqttAdapter);
});

test('loadBrokerConfig defaults to mqtt when BROKER_TYPE is unset', () => {
  const config = loadBrokerConfig({});
  assert.equal(config.type, 'mqtt');
});

test('loadBrokerConfig rejects a non-mqtt BROKER_TYPE', () => {
  assert.throws(() => loadBrokerConfig({ BROKER_TYPE: 'kafka' }));
  assert.throws(() => loadBrokerConfig({ BROKER_TYPE: 'rabbitmq' }));
});

test('mqtt config defaults (host/port/topic)', () => {
  const mqtt = loadBrokerConfig({ BROKER_TYPE: 'mqtt' });
  assert.equal(mqtt.host, 'mosquitto');
  assert.equal(mqtt.port, 1883);
  assert.equal(mqtt.topic, 'sensors/telemetry');
});
