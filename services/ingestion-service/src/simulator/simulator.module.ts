import { BrokerModule } from '@iots/broker';
import { Module, Provider } from '@nestjs/common';
import { IngestionConfig, INGESTION_CONFIG, loadIngestionConfig } from '../config/ingestion.config';
import { ControlController } from '../control/control.controller';
import { DATA_SOURCE } from '../data-source/data-source';
import { createDataSource } from '../data-source/data-source.factory';
import { SimulatorService } from './simulator.service';

const configProvider: Provider = {
  provide: INGESTION_CONFIG,
  useFactory: (): IngestionConfig => loadIngestionConfig(),
};

const dataSourceProvider: Provider = {
  provide: DATA_SOURCE,
  useFactory: (cfg: IngestionConfig) => createDataSource(cfg),
  inject: [INGESTION_CONFIG],
};

@Module({
  imports: [BrokerModule.forRoot()],
  controllers: [ControlController],
  providers: [configProvider, dataSourceProvider, SimulatorService],
})
export class SimulatorModule {}
