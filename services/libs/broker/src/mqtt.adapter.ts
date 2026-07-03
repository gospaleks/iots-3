import { connect, IClientOptions, MqttClient } from 'mqtt';
import { SensorMessage } from '@iots/contracts';
import { BrokerConfig } from './broker.config';
import { MessageHandler, PublisherAdapter, SubscriberAdapter } from './broker-adapter';

/** MQTT implementation (mqtt.js). A single client serves both publish and subscribe. */
export class MqttAdapter implements PublisherAdapter, SubscriberAdapter {
  private client?: MqttClient;

  constructor(private readonly config: BrokerConfig) {}

  async connect(): Promise<void> {
    if (this.client) return;
    const options: IClientOptions = {
      host: this.config.host,
      port: this.config.port,
      clientId: this.config.clientId,
      clean: this.config.cleanSession, // clean:false ⇒ persistent session (offline subscriber buffering)
      keepalive: this.config.keepaliveSec, // low ⇒ broker detects a dead client fast
      reconnectPeriod: 1000,
    };
    await new Promise<void>((resolve, reject) => {
      const client = connect(options);
      client.once('connect', () => resolve());
      client.once('error', (err) => reject(err));
      this.client = client;
    });
  }

  async publish(topic: string, message: SensorMessage): Promise<void> {
    const client = this.requireClient();
    const payload = JSON.stringify(message);
    await new Promise<void>((resolve, reject) => {
      client.publish(topic, payload, { qos: this.config.qos }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  async subscribe(topic: string, handler: MessageHandler): Promise<void> {
    const client = this.requireClient();
    client.on('message', (recvTopic, payload) => {
      const receivedAtMs = Date.now();
      const message = JSON.parse(payload.toString()) as SensorMessage;
      void handler(message, { topic: recvTopic, receivedAtMs });
    });
    await new Promise<void>((resolve, reject) => {
      client.subscribe(topic, { qos: this.config.qos }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    const client = this.client;
    this.client = undefined;
    await new Promise<void>((resolve) => client.end(false, {}, () => resolve()));
  }

  private requireClient(): MqttClient {
    if (!this.client) throw new Error('MqttAdapter: connect() must be called first');
    return this.client;
  }
}
