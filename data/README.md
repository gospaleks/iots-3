# data/

Place the dataset CSV here as `iot_telemetry_data.csv`. This directory's contents are **gitignored** (the dataset is large and not committed) — only this README is tracked.

- Source: Environmental Sensor Telemetry Data (see [../shared/dataset_info.md](../shared/dataset_info.md)).
- Used by the ingestion service in `DATA_SOURCE=replay` mode (`DATASET_PATH=/data/iot_telemetry_data.csv` inside containers).
- Optionally used to seed the database.

Expected CSV columns: `ts, device, co, humidity, light, lpg, motion, smoke, temp`.
