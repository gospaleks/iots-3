import { CepEvent } from "../api";

const TYPE_STYLES: Record<string, string> = {
  WINDOW_METRICS: "text-slate-400",
  HIGH_CO: "text-[#f5a524]",
  SUSTAINED_HIGH_TEMP: "text-[#f14a4a]",
  HEAT_DRYING: "text-[#f14a4a]",
};

function fmtNum(v: unknown, digits = 2): string {
  if (typeof v !== "number" || !isFinite(v)) return "—";
  return v.toFixed(digits);
}

export function EventFeed({ events }: { events: CepEvent[] }) {
  const recent = [...events].reverse().slice(0, 60);
  return (
    <section className="bg-[#111a2e] border border-[#26355e] rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-[#26355e] flex justify-between items-baseline">
        <h2 className="text-lg font-medium">CEP event feed</h2>
        <span className="text-xs mono text-slate-500">last {recent.length} · sensors/events</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        <table className="w-full text-sm mono">
          <thead className="sticky top-0 bg-[#182545] text-slate-300">
            <tr>
              <th className="text-left px-3 py-2">event_type</th>
              <th className="text-left px-3 py-2">device</th>
              <th className="text-right px-3 py-2">avg_temp</th>
              <th className="text-right px-3 py-2">humidity</th>
              <th className="text-right px-3 py-2">co</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((e, i) => (
              <tr key={i} className="border-t border-[#1c2a4a] hover:bg-[#182545]/60">
                <td className={"px-3 py-1.5 font-medium " + (TYPE_STYLES[e.event_type] ?? "text-slate-200")}>
                  {e.event_type}
                </td>
                <td className="px-3 py-1.5 text-slate-300">{e.device}</td>
                <td className="px-3 py-1.5 text-right">{fmtNum(e.avg_temp ?? e.temp)}</td>
                <td className="px-3 py-1.5 text-right">{fmtNum(e.avg_humidity, 1)}</td>
                <td className="px-3 py-1.5 text-right">{fmtNum(e.avg_co ?? e.co, 4)}</td>
              </tr>
            ))}
            {recent.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  Waiting for events over Socket.IO…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
