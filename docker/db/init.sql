-- TimescaleDB schema for the IoT telemetry stream.
-- Source of truth: ../../shared/dataset_info.md  (REQUIREMENTS.md §2.3, §2.5)
--
-- Runs once on first container start (mounted into /docker-entrypoint-initdb.d/).
-- The Storage Service uses TypeORM with synchronize:false — it must NOT manage
-- this schema (TypeORM cannot create hypertables).

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS sensor_data (
    ts          TIMESTAMPTZ      NOT NULL,   -- event time (epoch s in CSV -> tz)
    device      VARCHAR(255)     NOT NULL,   -- device MAC
    co          DOUBLE PRECISION,            -- ppm
    humidity    DOUBLE PRECISION,            -- %
    light       BOOLEAN,
    lpg         DOUBLE PRECISION,            -- ppm
    motion      BOOLEAN,
    smoke       DOUBLE PRECISION,            -- ppm
    temp        DOUBLE PRECISION,            -- Fahrenheit
    seq         BIGINT,                      -- per-device monotonic counter (loss/dup)
    sent_at_ms  BIGINT,                      -- wall-clock send time (epoch ms, latency)
    -- ts alone collides across the 3 devices; TimescaleDB also requires the
    -- partitioning column in any unique key. (ts, device) satisfies both.
    PRIMARY KEY (ts, device)
);

-- Convert to a hypertable partitioned on ts (time-series performance).
SELECT create_hypertable('sensor_data', 'ts', if_not_exists => TRUE);

-- Supports per-device, latest-first queries (analytics / inspection).
CREATE INDEX IF NOT EXISTS idx_sensor_data_device_ts
    ON sensor_data (device, ts DESC);
