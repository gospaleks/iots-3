import * as React from "react"

import { useLiveStreams } from "@/hooks/use-live-streams"
import { deriveWindowInfo } from "@/lib/window"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PipelineRail } from "@/components/pipeline-rail"
import { StatusHeader } from "@/components/status-header"
import { DeviceSelect } from "@/components/device-select"
import { ForecastChart } from "@/components/forecast-chart"
import { EventFeed } from "@/components/event-feed"
import { AlertFeed } from "@/components/alert-feed"

export function App() {
  const live = useLiveStreams()
  const [device, setDevice] = React.useState<string | null>(null)

  const devices = React.useMemo(() => {
    const set = new Set<string>()
    for (const e of live.events) set.add(e.device)
    for (const a of live.alerts) set.add(a.device)
    return [...set].sort()
  }, [live.events, live.alerts])

  // Auto-select the first device once the stream produces one.
  React.useEffect(() => {
    if (!device && devices.length > 0) setDevice(devices[0])
  }, [device, devices])

  const windowInfo = React.useMemo(
    () => deriveWindowInfo(live.events),
    [live.events],
  )

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <StatusHeader
        connected={live.connected}
        deviceCount={devices.length}
        windowInfo={windowInfo}
      />

      <PipelineRail
        eventsPerSec={live.eventsPerSec}
        totalEvents={live.totalEvents}
        forecasts={live.totalForecasts}
        totalAlerts={live.totalAlerts}
      />

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Temperature forecast</CardTitle>
          <CardDescription>
            Actual window average vs. the MaaS prediction for the next window
          </CardDescription>
          <CardAction>
            <DeviceSelect devices={devices} value={device} onChange={setDevice} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <ForecastChart
            device={device}
            events={live.events}
            alerts={live.alerts}
          />
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <EventFeed events={live.events} />
        <AlertFeed alerts={live.alerts} />
      </div>

      <footer className="pt-1 pb-4 text-center text-xs text-muted-foreground">
        Ingestion → eKuiper CEP → MaaS → Analytics · live via Socket.IO, seeded
        from REST
      </footer>
    </div>
  )
}

export default App
