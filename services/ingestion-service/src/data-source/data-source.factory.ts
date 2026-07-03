import { IngestionConfig } from '../config/ingestion.config';
import { DataSource } from './data-source';
import { RandomDataSource } from './random.data-source';
import { ReplayDataSource } from './replay.data-source';

/** The one place that maps DATA_SOURCE → concrete reading source. */
export function createDataSource(cfg: IngestionConfig): DataSource {
  switch (cfg.dataSource) {
    case 'replay':
      return new ReplayDataSource(cfg.datasetPath, cfg.replaySampleSize);
    case 'random':
      return new RandomDataSource();
    default:
      throw new Error(`Unsupported DATA_SOURCE: ${cfg.dataSource}`);
  }
}
