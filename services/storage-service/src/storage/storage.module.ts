import { BrokerModule } from '@iots/broker';
import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { loadStorageConfig, StorageConfig, STORAGE_CONFIG } from '../config/storage.config';
import { ControlController } from '../control/control.controller';
import { SensorDataEntity } from '../db/sensor-data.entity';
import { SensorWriterService } from './sensor-writer.service';
import { SubscriberService } from './subscriber.service';

const configProvider: Provider = {
  provide: STORAGE_CONFIG,
  useFactory: (): StorageConfig => loadStorageConfig(),
};

@Module({
  imports: [
    BrokerModule.forRoot(),
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        const cfg = loadStorageConfig();
        return {
          type: 'postgres',
          url: cfg.databaseUrl,
          entities: [SensorDataEntity],
          synchronize: false, // schema owned by docker/db/init.sql (hypertable)
        };
      },
    }),
  ],
  controllers: [ControlController],
  providers: [configProvider, SensorWriterService, SubscriberService],
})
export class StorageModule {}
