/** Two-up panel row: data integrity + latest analytics window. */
import type { AnalyticsStats, StorageStats } from "@/lib/types"
import { AnalyticsPanel } from "./analytics-panel"
import { IntegrityPanel } from "./integrity-panel"

export interface PanelsRowProps {
  storage: StorageStats | undefined
  analytics: AnalyticsStats | undefined
}

export function PanelsRow({ storage, analytics }: PanelsRowProps) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <IntegrityPanel storage={storage} />
      <AnalyticsPanel analytics={analytics} />
    </section>
  )
}
