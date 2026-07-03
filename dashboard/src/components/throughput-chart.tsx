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
  publishRate: { label: "Published", color: "var(--chart-2)" },
  storedRate: { label: "Stored", color: "var(--chart-4)" },
} satisfies ChartConfig

export function ThroughputChart({ data }: { data: Sample[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Throughput</CardTitle>
        <CardDescription>messages/second — published vs stored</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
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
              <YAxis
                tickLine={false}
                axisLine={false}
                width={44}
                allowDecimals={false}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                dataKey="publishRate"
                type="monotone"
                stroke="var(--color-publishRate)"
                fill="var(--color-publishRate)"
                fillOpacity={0.15}
                strokeWidth={2}
                isAnimationActive={false}
              />
              <Area
                dataKey="storedRate"
                type="monotone"
                stroke="var(--color-storedRate)"
                fill="var(--color-storedRate)"
                fillOpacity={0.15}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
