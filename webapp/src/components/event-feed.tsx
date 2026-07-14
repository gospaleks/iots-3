import * as React from "react"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Toggle } from "@/components/ui/toggle"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  EVENT_TYPES,
  deviceProfile,
  eventMeta,
  severityVariant,
  type CepEvent,
} from "@/lib/api"
import { formatClock, formatCo, formatTemp, toMillis } from "@/lib/format"

const MAX_ROWS = 60

function Legend() {
  return (
    <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
      {Object.entries(EVENT_TYPES).map(([type, meta]) => (
        <div key={type} className="flex items-start gap-2">
          <Badge variant={severityVariant(meta.severity)} className="mt-0.5 shrink-0">
            {meta.label}
          </Badge>
          <span className="text-xs text-muted-foreground">{meta.meaning}</span>
        </div>
      ))}
    </div>
  )
}

interface EventFeedProps {
  events: CepEvent[]
}

export function EventFeed({ events }: EventFeedProps) {
  const [hideRoutine, setHideRoutine] = React.useState(false)

  const rows = React.useMemo(() => {
    const filtered = hideRoutine
      ? events.filter((e) => e.event_type !== "WINDOW_METRICS")
      : events
    return filtered.slice(-MAX_ROWS).reverse()
  }, [events, hideRoutine])

  return (
    <Card className="min-w-0">
      <CardHeader className="border-b">
        <CardTitle>Event stream</CardTitle>
        <CardDescription>Detected by eKuiper on sensors/events</CardDescription>
        <CardAction>
          <Toggle
            variant="outline"
            size="sm"
            pressed={hideRoutine}
            onPressedChange={setHideRoutine}
            aria-label="Hide routine window metrics"
          >
            {hideRoutine ? "Show routine" : "Events only"}
          </Toggle>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Legend />
        <ScrollArea className="h-[340px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Device</TableHead>
                <TableHead className="text-right">Temp</TableHead>
                <TableHead className="text-right">CO</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-muted-foreground"
                  >
                    Waiting for events…
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((e, i) => {
                  const meta = eventMeta(e.event_type)
                  return (
                    <TableRow key={`${e.device}-${e.window_end ?? e.ts}-${i}`}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatClock(toMillis(e.window_end ?? e.ts))}
                      </TableCell>
                      <TableCell>
                        <Badge variant={severityVariant(meta.severity)}>
                          {meta.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {deviceProfile(e.device).label}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatTemp(e.avg_temp ?? e.temp)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatCo(e.avg_co ?? e.co)}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
