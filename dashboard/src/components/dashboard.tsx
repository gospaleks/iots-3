/**
 * Dashboard orchestrator — composes the live-data hooks with the four
 * presentation sections (status bar, stat grid, charts row, panels row,
 * footer). All visual styling lives inside the section components.
 */
import { useState } from "react"

import { useBurst } from "@/hooks/use-burst"
import { useDashboardData } from "@/hooks/use-dashboard-data"
import { burstHandlers } from "@/lib/burst-feedback"
import { BURST_DURATION_SEC, DEFAULT_POLL_MS } from "@/lib/constants"
import { ChartsRow } from "./charts-row"
import { DashboardFooter } from "./dashboard-footer"
import { PanelsRow } from "./panels-row"
import { StatGrid } from "./stat-grid"
import { StatusBar } from "./status-bar"

export function Dashboard() {
  const [pollMs, setPollMs] = useState(DEFAULT_POLL_MS)
  const { ingestion, storage, analytics, status, history } =
    useDashboardData(pollMs)
  const burst = useBurst()

  const storedRate = history.at(-1)?.storedRate ?? null

  function onBurst() {
    burst.mutate(BURST_DURATION_SEC, burstHandlers())
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 md:p-6">
      <StatusBar
        broker={analytics?.broker}
        status={status}
        pollMs={pollMs}
        onPollChange={setPollMs}
        onBurst={onBurst}
        bursting={Boolean(ingestion?.bursting)}
        burstPending={burst.isPending}
      />

      <StatGrid
        ingestion={ingestion}
        storage={storage}
        analytics={analytics}
        status={status}
        storedRate={storedRate}
      />

      <ChartsRow history={history} />

      <PanelsRow storage={storage} analytics={analytics} />

      <DashboardFooter pollMs={pollMs} />
    </div>
  )
}
