import { ActivityIcon, ZapIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { HealthIndicator } from "./health-indicator"
import type { ServiceStatus } from "@/hooks/use-dashboard-data"

const POLL_OPTIONS = [
  { value: "1000", label: "1s" },
  { value: "2000", label: "2s" },
  { value: "5000", label: "5s" },
]

interface StatusBarProps {
  broker?: string
  status: {
    ingestion: ServiceStatus
    storage: ServiceStatus
    analytics: ServiceStatus
  }
  pollMs: number
  onPollChange: (ms: number) => void
  onBurst: () => void
  bursting: boolean
  burstPending: boolean
}

export function StatusBar({
  broker,
  status,
  pollMs,
  onPollChange,
  onBurst,
  bursting,
  burstPending,
}: StatusBarProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ActivityIcon className="size-5" />
        </span>
        <div>
          <h1 className="text-lg leading-tight font-semibold">
            IoT Telemetry · Live Monitor
          </h1>
          <p className="text-xs text-muted-foreground">
            MQTT vs Kafka benchmark — live service metrics
          </p>
        </div>
        <Badge variant="outline" className="ml-1 uppercase">
          {broker ?? "—"}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <HealthIndicator label="ingestion" status={status.ingestion} />
          <HealthIndicator label="storage" status={status.storage} />
          <HealthIndicator label="analytics" status={status.analytics} />
        </div>
        <Separator orientation="vertical" className="h-6" />
        <ToggleGroup
          variant="outline"
          value={[String(pollMs)]}
          onValueChange={(value: string[]) => {
            if (value.length) onPollChange(Number(value[0]))
          }}
        >
          {POLL_OPTIONS.map((o) => (
            <ToggleGroupItem
              key={o.value}
              value={o.value}
              aria-label={`poll every ${o.label}`}
            >
              {o.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button onClick={onBurst} disabled={burstPending || bursting}>
          {burstPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ZapIcon data-icon="inline-start" />
          )}
          {bursting ? "Bursting…" : "Trigger burst"}
        </Button>
      </div>
    </header>
  )
}
