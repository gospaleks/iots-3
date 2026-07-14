import * as React from "react"
import {
  TrendUpIcon,
  TrendDownIcon,
  MinusIcon,
  ArrowRightIcon,
  SealCheckIcon,
  CircleDashedIcon,
} from "@phosphor-icons/react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { BellIcon } from "@phosphor-icons/react"
import {
  deviceProfile,
  eventMeta,
  severityVariant,
  type EnrichedAlert,
} from "@/lib/api"
import { formatClock, formatSignedDelta, formatTemp, toMillis } from "@/lib/format"

const MAX_CARDS = 40

function DeltaBadge({ actual, forecast }: { actual: number; forecast: number }) {
  const delta = forecast - actual
  const Icon = delta > 0.05 ? TrendUpIcon : delta < -0.05 ? TrendDownIcon : MinusIcon
  return (
    <Badge variant="outline" className="gap-1 font-mono tabular-nums">
      <Icon size={12} weight="bold" />
      {formatSignedDelta(delta)}
    </Badge>
  )
}

function AlertCard({ alert }: { alert: EnrichedAlert }) {
  const meta = eventMeta(alert.event_type)
  const profile = deviceProfile(alert.device)
  const hasForecast =
    alert.forecast_available &&
    alert.actual_avg_temp != null &&
    alert.forecast_next_avg_temp != null

  return (
    <div className="rounded-2xl bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={severityVariant(meta.severity)}>{meta.label}</Badge>
          <span className="text-xs text-muted-foreground">{profile.label}</span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {formatClock(toMillis(alert.ts))}
        </span>
      </div>

      {hasForecast ? (
        <div className="mt-3 flex items-center gap-3">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs text-muted-foreground">now</span>
            <span className="font-mono text-lg font-semibold tabular-nums">
              {formatTemp(alert.actual_avg_temp)}
            </span>
          </div>
          <ArrowRightIcon size={16} className="text-muted-foreground/60" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs text-muted-foreground">next</span>
            <span className="font-mono text-lg font-semibold tabular-nums text-primary">
              {formatTemp(alert.forecast_next_avg_temp)}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <DeltaBadge
              actual={alert.actual_avg_temp!}
              forecast={alert.forecast_next_avg_temp!}
            />
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <span className="font-mono text-lg font-semibold tabular-nums">
            {formatTemp(alert.actual_avg_temp)}
          </span>
          <span className="text-xs text-muted-foreground">
            forecast unavailable
          </span>
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        {hasForecast ? (
          <Badge variant="secondary" className="gap-1">
            <SealCheckIcon size={12} weight="fill" />
            forecast v{alert.model_version}
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1">
            <CircleDashedIcon size={12} />
            CEP-only
          </Badge>
        )}
      </div>
    </div>
  )
}

interface AlertFeedProps {
  alerts: EnrichedAlert[]
}

export function AlertFeed({ alerts }: AlertFeedProps) {
  const cards = React.useMemo(
    () => alerts.slice(-MAX_CARDS).reverse(),
    [alerts],
  )

  return (
    <Card className="min-w-0">
      <CardHeader className="border-b">
        <CardTitle>Predictive alerts</CardTitle>
        <CardDescription>
          Enriched with the MaaS next-window forecast
        </CardDescription>
      </CardHeader>
      <CardContent>
        {cards.length === 0 ? (
          <Empty className="h-[340px] border-0">
            <EmptyMedia variant="icon">
              <BellIcon />
            </EmptyMedia>
            <EmptyTitle>No alerts yet</EmptyTitle>
            <EmptyDescription>
              When eKuiper flags an event of interest, Analytics calls MaaS and a
              pre-emptive alert lands here.
            </EmptyDescription>
          </Empty>
        ) : (
          <ScrollArea className="h-[340px]">
            <div className="flex flex-col gap-2 pr-3">
              {cards.map((a, i) => (
                <AlertCard key={`${a.device}-${a.ts}-${i}`} alert={a} />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
