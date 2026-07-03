/** Two-up chart row: throughput + transport latency. */
import type { Sample } from "@/lib/types"
import { LatencyChart } from "./latency-chart"
import { ThroughputChart } from "./throughput-chart"

export interface ChartsRowProps {
  history: Sample[]
}

export function ChartsRow({ history }: ChartsRowProps) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <ThroughputChart data={history} />
      <LatencyChart data={history} />
    </section>
  )
}
