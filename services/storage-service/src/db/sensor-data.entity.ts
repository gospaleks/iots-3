import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Maps the `sensor_data` hypertable (schema owned by docker/db/init.sql — TypeORM
 * runs `synchronize:false`). The hot insert path uses a parameterized multi-row
 * query for exact `ON CONFLICT` counts; this entity documents the shape and is
 * available for ad-hoc repository reads/inspection.
 */
@Entity({ name: 'sensor_data' })
export class SensorDataEntity {
  @PrimaryColumn({ type: 'timestamptz' })
  ts!: Date;

  @PrimaryColumn({ type: 'varchar', length: 255 })
  device!: string;

  @Column({ type: 'double precision', nullable: true })
  co!: number;

  @Column({ type: 'double precision', nullable: true })
  humidity!: number;

  @Column({ type: 'boolean', nullable: true })
  light!: boolean;

  @Column({ type: 'double precision', nullable: true })
  lpg!: number;

  @Column({ type: 'boolean', nullable: true })
  motion!: boolean;

  @Column({ type: 'double precision', nullable: true })
  smoke!: number;

  @Column({ type: 'double precision', nullable: true })
  temp!: number;

  @Column({ type: 'bigint', nullable: true })
  seq!: string;

  @Column({ type: 'bigint', name: 'sent_at_ms', nullable: true })
  sentAtMs!: string;
}
