/**
 * Central place for tunables shared between the dashboard hook and the
 * orchestrator component. Values match what was previously inlined in
 * use-dashboard-data.ts and components/dashboard.tsx.
 */

/** Max number of points the rolling chart buffer retains. */
export const HISTORY_CAPACITY = 60

/** Default poll cadence for the three /stats queries (ms). */
export const DEFAULT_POLL_MS = 1000

/** How long a single Scenario-C burst runs when triggered from the UI (s). */
export const BURST_DURATION_SEC = 20
