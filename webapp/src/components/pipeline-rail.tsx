// Signature element: the live pipeline. The whole project is a flow — raw
// telemetry → eKuiper CEP → MaaS forecast → enriched alerts — so the hero makes
// that flow the thing you watch, with a live counter under each stage.
import {
  BroadcastIcon,
  FunnelSimpleIcon,
  BrainIcon,
  BellIcon,
  CaretRightIcon,
  type Icon,
} from "@phosphor-icons/react"

import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface Stage {
  icon: Icon
  name: string
  sub: string
  value: string
  tone: "muted" | "primary"
}

function Stage({ icon: StageIcon, name, sub, value, tone }: Stage) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl",
          tone === "primary"
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground",
        )}
      >
        <StageIcon size={18} weight="duotone" />
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">{name}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">{sub}</div>
      </div>
      <div className="ml-auto text-right">
        <div className="font-mono text-sm font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  )
}

function Arrow() {
  return (
    <CaretRightIcon
      size={16}
      weight="bold"
      className="mx-1 hidden shrink-0 text-muted-foreground/50 md:block"
    />
  )
}

interface PipelineRailProps {
  eventsPerSec: number
  totalEvents: number
  forecasts: number
  totalAlerts: number
}

export function PipelineRail({
  eventsPerSec,
  totalEvents,
  forecasts,
  totalAlerts,
}: PipelineRailProps) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col divide-y md:flex-row md:items-stretch md:divide-x md:divide-y-0">
        <Stage
          icon={BroadcastIcon}
          name="Ingestion"
          sub="raw telemetry → MQTT"
          value={`${eventsPerSec.toFixed(1)}/s`}
          tone="muted"
        />
        <Arrow />
        <Stage
          icon={FunnelSimpleIcon}
          name="eKuiper CEP"
          sub="detected events"
          value={totalEvents.toLocaleString()}
          tone="primary"
        />
        <Arrow />
        <Stage
          icon={BrainIcon}
          name="MaaS forecast"
          sub="next-window temp"
          value={forecasts.toLocaleString()}
          tone="primary"
        />
        <Arrow />
        <Stage
          icon={BellIcon}
          name="Alerts"
          sub="pre-emptive"
          value={totalAlerts.toLocaleString()}
          tone="muted"
        />
      </div>
    </Card>
  )
}
