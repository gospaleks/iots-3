# docker/kafka/

Kafka runs in **KRaft mode** (no ZooKeeper). There is no `server.properties` file here — the official `apache/kafka` image is configured entirely through `KAFKA_*` environment variables in [`../docker-compose.yml`](../docker-compose.yml) (the `kafka` service, profile `kafka`).

## Listeners

| Listener        | Address          | Used by                                   |
|-----------------|------------------|-------------------------------------------|
| `PLAINTEXT`     | `kafka:9092`     | In-network clients (ingestion, storage)   |
| `PLAINTEXT_HOST`| `localhost:29092`| Host tools (kafka-producer-perf-test, k6) |
| `CONTROLLER`    | `kafka:9093`     | KRaft controller quorum                    |

## Cluster id

`KAFKA_CLUSTER_ID` (in `.env`) keeps the storage volume reproducible across restarts. Generate a fresh one if needed:

```bash
docker run --rm apache/kafka:3.8.1 /opt/kafka/bin/kafka-storage.sh random-uuid
```

## Partition scaling (Scenario A)

`KAFKA_NUM_PARTITIONS` sets the default partition count (1 baseline; test 3 and 6 for consumer-parallelism analysis — REQUIREMENTS §6.2).
