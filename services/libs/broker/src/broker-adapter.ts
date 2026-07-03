import { SensorMessage } from '@iots/contracts';

export type BrokerType = 'mqtt' | 'kafka';

/** Metadata captured at receive time — `receivedAtMs` feeds transport latency. */
export interface ReceivedMeta {
  topic: string;
  receivedAtMs: number;
}

export type MessageHandler = (
  message: SensorMessage,
  meta: ReceivedMeta,
) => void | Promise<void>;

/** Lifecycle shared by both sides. */
export interface BrokerAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

/** Ingestion side. QoS/acks are adapter-internal — the interface stays broker-neutral. */
export interface PublisherAdapter extends BrokerAdapter {
  publish(topic: string, message: SensorMessage): Promise<void>;
}

/** Storage / subscriber side. */
export interface SubscriberAdapter extends BrokerAdapter {
  subscribe(topic: string, handler: MessageHandler): Promise<void>;
}
