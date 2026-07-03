import { Consumer, Kafka, logLevel, Producer } from 'kafkajs';
import { SensorMessage } from '@iots/contracts';
import { BrokerConfig } from './broker.config';
import { MessageHandler, PublisherAdapter, SubscriberAdapter } from './broker-adapter';

/**
 * Kafka implementation (kafkajs). Producer and consumer connect lazily so a
 * publisher-only service never spins up a consumer (and vice versa).
 */
export class KafkaAdapter implements PublisherAdapter, SubscriberAdapter {
  private readonly kafka: Kafka;
  private producer?: Producer;
  private consumer?: Consumer;

  constructor(private readonly config: BrokerConfig) {
    this.kafka = new Kafka({
      clientId: config.clientId,
      brokers: [`${config.host}:${config.port}`],
      logLevel: logLevel.NOTHING,
    });
  }

  /** Lifecycle hook — actual producer/consumer connect lazily on first use. */
  async connect(): Promise<void> {}

  async publish(topic: string, message: SensorMessage): Promise<void> {
    if (!this.producer) {
      this.producer = this.kafka.producer({ allowAutoTopicCreation: true });
      await this.producer.connect();
    }
    await this.producer.send({
      topic,
      acks: this.config.acks,
      // Keying by device gives per-device partition affinity ⇒ seq stays ordered.
      messages: [{ key: message.device, value: JSON.stringify(message) }],
    });
  }

  async subscribe(topic: string, handler: MessageHandler): Promise<void> {
    // A subscriber may start before any producer has created the topic. Ensure it
    // exists (with a leader) first, so subscribe() can't hit UNKNOWN_TOPIC_OR_PARTITION.
    await this.ensureTopic(topic);
    if (!this.consumer) {
      this.consumer = this.kafka.consumer({ groupId: this.config.groupId });
      await this.consumer.connect();
    }
    await this.consumer.subscribe({ topic, fromBeginning: false });
    await this.consumer.run({
      eachMessage: async ({ topic: recvTopic, message: m }) => {
        const receivedAtMs = Date.now();
        if (!m.value) return;
        const parsed = JSON.parse(m.value.toString()) as SensorMessage;
        await handler(parsed, { topic: recvTopic, receivedAtMs });
      },
    });
  }

  async disconnect(): Promise<void> {
    await this.producer?.disconnect();
    await this.consumer?.disconnect();
    this.producer = undefined;
    this.consumer = undefined;
  }

  /** Idempotently create the topic (no-op if it exists) and wait for a partition leader. */
  private async ensureTopic(topic: string): Promise<void> {
    const admin = this.kafka.admin();
    await admin.connect();
    try {
      await admin.createTopics({ topics: [{ topic }], waitForLeaders: true });
    } finally {
      await admin.disconnect();
    }
  }
}
