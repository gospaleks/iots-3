import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StatusBar } from "./components/StatusBar";
import { EventFeed } from "./components/EventFeed";
import { AlertFeed } from "./components/AlertFeed";
import { ForecastChart } from "./components/ForecastChart";
import { DeviceSelector } from "./components/DeviceSelector";
import { fetchAlerts, fetchDevices, fetchEvents } from "./api";
import { useLiveStreams } from "./hooks/useLiveStreams";

export default function App() {
  // Initial snapshots from REST — seed the UI so it looks alive on first paint.
  const eventsQ = useQuery({ queryKey: ["events"], queryFn: () => fetchEvents(150) });
  const alertsQ = useQuery({ queryKey: ["alerts"], queryFn: () => fetchAlerts(80) });
  const devicesQ = useQuery({
    queryKey: ["devices"],
    queryFn: fetchDevices,
    refetchInterval: 5000,
  });

  const { events, alerts, connected } = useLiveStreams(eventsQ.data ?? [], alertsQ.data ?? []);

  const devices = useMemo(() => {
    const set = new Set<string>(devicesQ.data ?? []);
    for (const e of events) if (e.device) set.add(e.device);
    return Array.from(set).sort();
  }, [devicesQ.data, events]);

  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!selected && devices.length > 0) setSelected(devices[0]);
  }, [devices, selected]);

  return (
    <div className="min-h-screen flex flex-col">
      <StatusBar connected={connected} deviceCount={devices.length} />
      <main className="flex-1 p-6 space-y-6 max-w-[1400px] mx-auto w-full">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="text-slate-300">
            <p className="mono text-sm">
              live via <span className="text-[#4dabf7]">Socket.IO</span> · initial from{" "}
              <span className="text-[#4dabf7]">REST /api/*</span>
            </p>
          </div>
          <DeviceSelector devices={devices} value={selected} onChange={setSelected} />
        </div>

        <ForecastChart device={selected} events={events} alerts={alerts} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <EventFeed events={events} />
          <AlertFeed alerts={alerts} />
        </div>

        <footer className="text-xs text-slate-500 mono text-center pb-6">
          IoTS Project 3 — Ingestion · Storage · eKuiper CEP · MaaS (RandomForest, next-window avg_temp) · Analytics orchestrator · Web UI
        </footer>
      </main>
    </div>
  );
}
