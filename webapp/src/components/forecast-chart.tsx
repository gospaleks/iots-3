// Actual vs. forecast temperature for the selected device.
//
// Correctness under any window mode: instead of merging the two series on an exact
// timestamp key (which only lines up for contiguous tumbling windows), both series
// live on one numeric time axis and are bucketed to the second. The forecast point
// is placed at window_end + window_width so it leads the actual line ("pre-emptive").
// Overlapping hopping/sliding windows collapse to ≤1 point per second, and the view
// is bounded to a time range, so a burst can never flood the chart.
import * as React from "react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ChartLineIcon } from "@phosphor-icons/react"
import type { CepEvent, EnrichedAlert } from "@/lib/api"
import { formatClock, toMillis } from "@/lib/format"

const VIEW_MS = 8 * 60 * 1000 // keep the last ~8 minutes visible
const secondBucket = (ms: number) => Math.round(ms / 1000) * 1000

const chartConfig = {
  actual: { label: "Actual avg", color: "var(--chart-2)" },
  forecast: { label: "Forecast next", color: "var(--chart-4)" },
} satisfies ChartConfig

interface Row {
  t: number
  actual?: number
  forecast?: number
}

interface ForecastChartProps {
  device: string | null
  events: CepEvent[]
  alerts: EnrichedAlert[]
}

export function ForecastChart({ device, events, alerts }: ForecastChartProps) {
  const data = React.useMemo<Row[]>(() => {
    if (!device) return []
    const rows = new Map<number, Row>()
    const put = (t: number, patch: Partial<Row>) => {
      const k = secondBucket(t)
      rows.set(k, { t: k, ...rows.get(k), ...patch })
    }

    for (const e of events) {
      if (e.event_type !== "WINDOW_METRICS" || e.device !== device) continue
      const t = toMillis(e.window_end ?? e.ts)
      if (t != null && e.avg_temp != null) put(t, { actual: e.avg_temp })
    }

    for (const a of alerts) {
      if (a.device !== device || !a.forecast_available) continue
      if (a.forecast_next_avg_temp == null) continue
      const end = toMillis(a.window_end)
      const start = toMillis(a.window_start)
      const width = end != null && start != null ? end - start : 0
      const t = end != null ? end + width : toMillis(a.ts)
      if (t != null) put(t, { forecast: a.forecast_next_avg_temp })
    }

    const sorted = [...rows.values()].sort((x, y) => x.t - y.t)
    if (sorted.length === 0) return []
    const cutoff = sorted[sorted.length - 1].t - VIEW_MS
    return sorted.filter((r) => r.t >= cutoff)
  }, [device, events, alerts])

  if (data.length === 0) {
    return (
      <Empty className="h-[320px] border-0">
        <EmptyMedia variant="icon">
          <ChartLineIcon />
        </EmptyMedia>
        <EmptyTitle>No readings yet</EmptyTitle>
        <EmptyDescription>
          The line fills as WINDOW_METRICS arrive; forecast dots appear when an event
          of interest triggers a MaaS prediction.
        </EmptyDescription>
      </Empty>
    )
  }

  return (
    <ChartContainer config={chartConfig} style={{ height: 320 }} className="w-full">
      <LineChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(v) => formatClock(v)}
          tickMargin={8}
          minTickGap={48}
        />
        <YAxis
          width={44}
          tickMargin={4}
          domain={[
            (min: number) => Math.floor(min - 1),
            (max: number) => Math.ceil(max + 1),
          ]}
          tickFormatter={(v) => `${v}°`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => formatClock(payload?.[0]?.payload?.t)}
              indicator="dot"
            />
          }
        />
        <Line
          dataKey="actual"
          type="monotone"
          stroke="var(--color-actual)"
          strokeWidth={2}
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          dataKey="forecast"
          type="monotone"
          stroke="var(--color-forecast)"
          strokeWidth={2}
          strokeDasharray="4 4"
          dot={{ r: 3, strokeWidth: 0, fill: "var(--color-forecast)" }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  )
}
