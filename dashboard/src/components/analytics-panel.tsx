import type { LucideIcon } from "lucide-react"
import {
  ThermometerIcon,
  TriangleAlertIcon,
  WavesIcon,
  WindIcon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { fmtFixed, fmtInt, fmtMs } from "@/lib/format"
import type { AnalyticsStats } from "@/lib/types"

function Reading({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </div>
  )
}

export function AnalyticsPanel({ analytics }: { analytics?: AnalyticsStats }) {
  const w = analytics?.lastWindow ?? null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Latest window</CardTitle>
        <CardDescription>
          {fmtInt(analytics?.windowSizeSec)}s tumbling · alert ≥{" "}
          {fmtFixed(analytics?.alertThreshold)}°F avg temp
        </CardDescription>
        <CardAction>
          <Badge variant="secondary">
            {fmtInt(analytics?.windows)} windows · {fmtInt(analytics?.alerts)}{" "}
            alerts
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!w ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ThermometerIcon />
              </EmptyMedia>
              <EmptyTitle>No window closed yet</EmptyTitle>
              <EmptyDescription>
                The first summary appears after one full window.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            {w.alert ? (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>Threshold exceeded</AlertTitle>
                <AlertDescription>
                  avg temp {fmtFixed(w.avg_temp)}°F ≥{" "}
                  {fmtFixed(analytics?.alertThreshold)}°F over {fmtInt(w.count)}{" "}
                  messages
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="grid grid-cols-3 gap-3">
              <Reading
                icon={ThermometerIcon}
                label="Temp"
                value={`${fmtFixed(w.avg_temp)}°F`}
              />
              <Reading
                icon={WavesIcon}
                label="Humidity"
                value={`${fmtFixed(w.avg_humidity)}%`}
              />
              <Reading
                icon={WindIcon}
                label="CO"
                value={fmtFixed(w.avg_co, 4)}
              />
            </div>
            <div className="text-xs text-muted-foreground">
              {fmtInt(w.count)} messages · event→alert avg{" "}
              {fmtMs(w.event_to_alert_avg_ms)} / max{" "}
              {fmtMs(w.event_to_alert_max_ms)}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
