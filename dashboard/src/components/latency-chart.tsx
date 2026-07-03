import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { ChartPlaceholder } from "./chart-placeholder"
import type { Sample } from "@/lib/types"

const config = {
  transportMs: { label: "Transport", color: "var(--chart-3)" },
} satisfies ChartConfig

export function LatencyChart({ data }: { data: Sample[] }) {
  const hasData = data.some((d) => d.transportMs != null)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transport latency</CardTitle>
        <CardDescription>
          broker delivery time (receive − sent_at_ms), ms per interval
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <ChartPlaceholder />
        ) : (
          <ChartContainer config={config} className="h-[220px] w-full">
            <AreaChart data={data} margin={{ left: 4, right: 4, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={48}
              />
              <YAxis tickLine={false} axisLine={false} width={44} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                dataKey="transportMs"
                type="monotone"
                stroke="var(--color-transportMs)"
                fill="var(--color-transportMs)"
                fillOpacity={0.15}
                strokeWidth={2}
                isAnimationActive={false}
                connectNulls
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
