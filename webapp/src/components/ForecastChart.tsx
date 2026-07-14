import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { CepEvent, EnrichedAlert } from "../api";

const HISTORY_WINDOWS = 60;

function baseDevice(id: string): string {
  return id.replace(/-\d+$/, "");
}

export function ForecastChart({
  device,
  events,
  alerts,
}: {
  device: string | null;
  events: CepEvent[];
  alerts: EnrichedAlert[];
}) {
  const data = useMemo(() => {
    if (!device) return [];
    // Match by base device (Analytics/eKuiper see the fanned-out id `MAC-N`).
    const target = device;
    const actual = events
      .filter((e) => e.event_type === "WINDOW_METRICS" && e.device === target)
      .map((e) => ({
        ts: (e.window_end as number) ?? 0,
        actual_avg_temp: e.avg_temp,
      }));
    const forecasts = alerts
      .filter((a) => a.device === target && a.forecast_next_avg_temp != null)
      .map((a) => {
        // The forecast targets the NEXT window — shift one window length forward so it
        // lands on the window_end of the actual point it predicts (tumbling windows are
        // contiguous). Alerts without window info (e.g. per-message HIGH_CO) stay at ts.
        const winMs =
          a.window_end != null && a.window_start != null ? a.window_end - a.window_start : 0;
        return {
          ts: (a.window_end ?? a.ts * 1000) + winMs,
          forecast_next_avg_temp: a.forecast_next_avg_temp,
        };
      });

    // Merge series by timestamp (bucket coarsely by seconds).
    const merged: Record<string, any> = {};
    for (const p of actual) {
      const key = String(p.ts);
      merged[key] = { ...(merged[key] ?? { ts: p.ts }), actual_avg_temp: p.actual_avg_temp };
    }
    for (const p of forecasts) {
      const key = String(p.ts);
      merged[key] = { ...(merged[key] ?? { ts: p.ts }), forecast_next_avg_temp: p.forecast_next_avg_temp };
    }
    return Object.values(merged)
      .sort((a: any, b: any) => a.ts - b.ts)
      .slice(-HISTORY_WINDOWS);
  }, [device, events, alerts]);

  const latestActual = data.filter((d: any) => d.actual_avg_temp != null).pop() as any;
  const latestForecast = data.filter((d: any) => d.forecast_next_avg_temp != null).pop() as any;

  return (
    <section className="bg-[#111a2e] border border-[#26355e] rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-[#26355e] flex justify-between items-baseline">
        <div>
          <h2 className="text-lg font-medium">Predicted vs actual avg_temp</h2>
          <p className="text-xs text-slate-500 mono">
            {device ? `device=${device} · base=${baseDevice(device)}` : "select a device"}
          </p>
        </div>
        <div className="text-xs mono text-right">
          <div>
            actual&nbsp;=&nbsp;
            <span className="text-white">{latestActual?.actual_avg_temp?.toFixed(2) ?? "—"} °C</span>
          </div>
          <div>
            forecast&nbsp;=&nbsp;
            <span className="text-[#4dabf7]">{latestForecast?.forecast_next_avg_temp?.toFixed(2) ?? "—"} °C</span>
          </div>
        </div>
      </div>
      <div className="h-[280px] p-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="#1c2a4a" strokeDasharray="3 3" />
            <XAxis
              dataKey="ts"
              stroke="#8b9dc3"
              fontSize={11}
              tickFormatter={(v) => {
                const d = new Date(v);
                return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(
                  d.getSeconds()
                ).padStart(2, "0")}`;
              }}
            />
            <YAxis stroke="#8b9dc3" fontSize={11} domain={["dataMin - 0.5", "dataMax + 0.5"]} />
            <Tooltip
              contentStyle={{ background: "#0b1220", border: "1px solid #26355e", fontSize: 12 }}
              labelFormatter={(v) => new Date(v).toISOString().slice(11, 19)}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="actual_avg_temp"
              name="actual"
              stroke="#e6ebf5"
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="forecast_next_avg_temp"
              name="forecast (next window)"
              stroke="#4dabf7"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={{ r: 3 }}
              connectNulls
            />
            {latestForecast && (
              <ReferenceLine
                y={latestForecast.forecast_next_avg_temp}
                stroke="#4dabf7"
                strokeDasharray="2 4"
                strokeOpacity={0.5}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
