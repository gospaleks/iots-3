# Iteration 0 — Docs reorg, scaffolding, project reference

**Goal:** Establish structure and source-of-truth docs before any code, so later iterations have a stable foundation.

## Tasks

- [x] Create `docs/`; `git mv` `REQUIREMENTS.md` + `DECISIONS.md` into it (history preserved).
- [x] Apply doc corrections: REQUIREMENTS §2.3/§2.4 (`seq`, `sent_at_ms`), §2.5 (TimescaleDB hypertable, PK `(ts, device)`), §3 (TimescaleDB + WSL2 notes), §5.1 (data source env), §5.2 (size-OR-time batch flush), §5.3 (dual latency), §11 (unified layout). DECISIONS §7 refinements added.
- [x] Materialize `docs/PLAN.md` (index) + `docs/plan/00–08`.
- [ ] Create `shared/dataset_info.md` + `shared/message-contract.md`.
- [ ] Create `CLAUDE.md` (project reference + change log) and initial `README.md`.
- [ ] Add `.gitignore` (incl. `data/`) + directory skeletons (`services/`, `docker/`, `benchmarks/`, `results/`, `data/`) with `.gitkeep` where empty.

## Key files

- `docs/REQUIREMENTS.md`, `docs/DECISIONS.md`, `docs/PLAN.md`, `docs/plan/*`
- `shared/dataset_info.md`, `shared/message-contract.md`
- `CLAUDE.md`, `README.md`, `.gitignore`

## Verification

- Docs render; internal links resolve.
- `git status` shows renames (R) for the two moved files.
- `git check-ignore data/anything` confirms `data/` is ignored.
- Directory tree matches REQUIREMENTS §11.

## Commit

`docs: reorganize into docs/, define unified architecture + implementation plan`
