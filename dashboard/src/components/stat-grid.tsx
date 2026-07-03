/**
 * 6-card stat grid. Markup + Tailwind classes are preserved byte-for-byte from
 * the previous inline section in `dashboard.tsx`.
 */
import {
  ArrowDownToLineIcon,
  BellIcon,
  CircleAlertIcon,
  DatabaseIcon,
  GaugeIcon,
  SendIcon,
} from "lucide-react"

import type { DashboardStatusBag } from "@/hooks/use-dashboard-data"
import { fmtInt, fmtMs, fmtRate } from "@/lib/format"
import type {
  AnalyticsStats,
  IngestionStats,
  StorageStats,
} from "@/lib/types"
import { StatCard } from "./stat-card"

export interface StatGridProps {
  ingestion: IngestionStats | undefined
  storage: StorageStats | undefined
  analytics: AnalyticsStats | undefined
  status: DashboardStatusBag
  storedRate: number | null
}

export function StatGrid(props: StatGridProps) {
  const { ingestion, storage, analytics, status, storedRate } = props

  return (
    <section className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
      <StatCard
        label="Publish rate"
        value={fmtRate(ingestion?.currentRatePerSec)}
        unit="msg/s"
        icon={SendIcon}
        loading={status.ingestion === "loading"}
        sub={`baseline ${fmtRate(ingestion?.baselineRatePerSec)} · ${fmtInt(ingestion?.numDevices)} devices`}
      />
      <StatCard
        label="Stored rate"
        value={fmtRate(storedRate)}
        unit="msg/s"
        icon={ArrowDownToLineIcon}
        sub={`${fmtInt(storage?.writer.flushes)} flushes`}
      />
      <StatCard
        label="Total stored"
        value={fmtInt(storage?.writer.stored)}
        icon={DatabaseIcon}
        loading={status.storage === "loading"}
        sub={`${fmtInt(storage?.writer.received)} received`}
      />
      <StatCard
        label="Transport latency"
        value={fmtMs(storage?.transportLatencyMs.avgMs)}
        icon={GaugeIcon}
        loading={status.storage === "loading"}
        sub={`max ${fmtMs(storage?.transportLatencyMs.maxMs)}`}
      />
      <StatCard
        label="Event→alert"
        value={fmtMs(analytics?.eventToAlertLatencyMs.avg)}
        icon={BellIcon}
        loading={status.analytics === "loading"}
        sub={`max ${fmtMs(analytics?.eventToAlertLatencyMs.max)}`}
      />
      <StatCard
        label="Alerts"
        value={fmtInt(analytics?.alerts)}
        icon={CircleAlertIcon}
        loading={status.analytics === "loading"}
        emphasis={Boolean(analytics && analytics.alerts > 0)}
        sub={`${fmtInt(analytics?.windows)} windows`}
      />
    </section>
  )
}
