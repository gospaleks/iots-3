import 'reflect-metadata';
import { DynamicModule, Module, Provider } from '@nestjs/common';
import { BrokerConfig, loadBrokerConfig } from './broker.config';
import { KafkaAdapter } from './kafka.adapter';
import { MqttAdapter } from './mqtt.adapter';

/** DI tokens — business code injects BROKER_ADAPTER, never a concrete adapter. */
export const BROKER_ADAPTER = Symbol('BROKER_ADAPTER');
export const BROKER_CONFIG = Symbol('BROKER_CONFIG');

/**
 * The one and only place that maps BROKER_TYPE → concrete adapter.
 * Exported standalone so it can be unit-tested without bootstrapping Nest.
 */
export function createBrokerAdapter(config: BrokerConfig): MqttAdapter | KafkaAdapter {
  switch (config.type) {
    case 'mqtt':
      return new MqttAdapter(config);
    case 'kafka':
      return new KafkaAdapter(config);
    default:
      throw new Error(`Unsupported broker type: ${(config as BrokerConfig).type}`);
  }
}

@Module({})
export class BrokerModule {
  /** Global module exposing the env-selected adapter. Pass overrides for tests. */
  static forRoot(overrides?: Partial<BrokerConfig>): DynamicModule {
    const configProvider: Provider = {
      provide: BROKER_CONFIG,
      useFactory: (): BrokerConfig => ({ ...loadBrokerConfig(), ...overrides }),
    };
    const adapterProvider: Provider = {
      provide: BROKER_ADAPTER,
      useFactory: (config: BrokerConfig) => createBrokerAdapter(config),
      inject: [BROKER_CONFIG],
    };
    return {
      module: BrokerModule,
      global: true,
      providers: [configProvider, adapterProvider],
      exports: [BROKER_ADAPTER, BROKER_CONFIG],
    };
  }
}
