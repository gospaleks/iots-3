import {
  PlugsConnectedIcon,
  PlugsIcon,
  GaugeIcon,
  PulseIcon,
} from "@phosphor-icons/react"

import { Badge } from "@/components/ui/badge"
import type { WindowInfo } from "@/lib/api"

interface StatusHeaderProps {
  connected: boolean
  deviceCount: number
  windowInfo: WindowInfo | null
}

export function StatusHeader({
  connected,
  deviceCount,
  windowInfo,
}: StatusHeaderProps) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <PulseIcon size={22} weight="duotone" />
        </div>
        <div>
          <h1 className="font-heading text-lg leading-tight font-semibold tracking-tight">
            Sensor Pipeline — CEP &amp; Forecast
          </h1>
          <p className="text-xs text-muted-foreground">
            eKuiper detects · MaaS predicts · Analytics alerts, live
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1.5">
          <GaugeIcon size={12} weight="bold" />
          window {windowInfo?.label ?? "…"}
        </Badge>
        <Badge variant="outline">{deviceCount} devices</Badge>
        <Badge variant={connected ? "default" : "destructive"} className="gap-1.5">
          {connected ? (
            <PlugsConnectedIcon size={12} weight="bold" />
          ) : (
            <PlugsIcon size={12} weight="bold" />
          )}
          {connected ? "Live" : "Offline"}
        </Badge>
      </div>
    </header>
  )
}
