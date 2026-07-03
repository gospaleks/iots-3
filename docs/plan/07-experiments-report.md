# Iteration 7 — Experiments + report

**Goal:** Execute the full scenario matrix and write the technical report (deliverable #6).

## Tasks

- Run the full matrix: MQTT QoS {0,1,2} × {100,1000,10000} and Kafka acks {0,1,all} × {100,1000,10000} (Scenario A); plus B, C, D on both brokers.
- Archive raw results under `results/`.
- Fill `docs/report.md`:
  - System description.
  - Performance comparison table (REQUIREMENTS §8.4) from real CSVs.
  - Scenario B/C/D findings (recovery, backlog, latency).
  - Answer Critical Question 1 (MQTT edge vs analytics) and Question 2 (Kafka cloud cost, edge viability) — REQUIREMENTS §9.
- Tick REQUIREMENTS §12 checklist items as completed.

## Verification

- Table fully populated; every cell traceable to a CSV in `results/`.
- Both critical questions answered with evidence from the runs.

## Commit

`docs(report): experimental results + MQTT vs Kafka comparative analysis`
