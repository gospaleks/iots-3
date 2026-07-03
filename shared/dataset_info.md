# Dataset — Source of Truth

> Mirrors [../docs/REQUIREMENTS.md](../docs/REQUIREMENTS.md) §2. This is the quick reference every service imports its field knowledge from.

## Overview

| Property          | Value                                          |
|-------------------|------------------------------------------------|
| Name              | Environmental Sensor Telemetry Data            |
| Origin            | Three Raspberry Pi + Breadboard sensor arrays  |
| Total Rows        | 405,184                                         |
| Time Range        | 07/12/2020 – 07/19/2020                         |
| Original Protocol | MQTT                                            |
| CSV location      | `data/iot_telemetry_data.csv` (**gitignored**) |

## Devices (§2.2)

| Device ID (MAC)     | Environmental Condition              |
|---------------------|--------------------------------------|
| `00:0f:00:70:91:0a` | Stable, cooler, more humid           |
| `1c:bf:ce:15:ec:4d` | Highly variable temperature/humidity |
| `b8:27:eb:bf:9d:51` | Stable, warmer, dryer                |

## Schema — `sensor_data` (TimescaleDB hypertable)

| Column       | SQL Type      | JSON Type | Notes                              |
|--------------|---------------|-----------|------------------------------------|
| `ts`         | `TIMESTAMPTZ` | number    | Event time (epoch s in CSV → tz)   |
| `device`     | `VARCHAR`     | string    | MAC address                        |
| `co`         | `FLOAT8`      | number    | ppm                                |
| `humidity`   | `FLOAT8`      | number    | %                                  |
| `light`      | `BOOLEAN`     | bool      |                                    |
| `lpg`        | `FLOAT8`      | number    | ppm                                |
| `motion`     | `BOOLEAN`     | bool      |                                    |
| `smoke`      | `FLOAT8`      | number    | ppm                                |
| `temp`       | `FLOAT8`      | number    | Fahrenheit                         |
| `seq`        | `BIGINT`      | number    | **added** — per-device counter     |
| `sent_at_ms` | `BIGINT`      | number    | **added** — send time (epoch ms)   |

- **Hypertable** partitioned on `ts`; **PK `(ts, device)`** (`ts` alone collides across devices, and TimescaleDB requires the partition column in any unique key).
- Schema created by `docker/db/init.sql` (extension + table + `create_hypertable`). Storage uses TypeORM `synchronize: false`.
- Primary window-analytics metrics: `temp`, `humidity`, `co`.

## Alert thresholds (§2.6)

| Metric | Default        |
|--------|----------------|
| `temp` | > 50 °F        |
| `co`   | configurable   |
| `smoke`| configurable   |
