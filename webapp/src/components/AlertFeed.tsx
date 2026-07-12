import { EnrichedAlert } from "../api";

export function AlertFeed({ alerts }: { alerts: EnrichedAlert[] }) {
  const recent = [...alerts].reverse().slice(0, 40);
  return (
    <section className="bg-[#111a2e] border border-[#26355e] rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-[#26355e] flex justify-between items-baseline">
        <h2 className="text-lg font-medium">Predictive alerts <span className="text-slate-500 text-sm">(Analytics + MaaS)</span></h2>
        <span className="text-xs mono text-slate-500">last {recent.length}</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto p-3 space-y-2">
        {recent.map((a, i) => (
          <div
            key={i}
            className={
              "rounded border p-3 text-sm " +
              (a.forecast_available
                ? "border-[#4dabf7]/40 bg-[#4dabf7]/5"
                : "border-slate-600 bg-slate-800/40")
            }
          >
            <div className="flex justify-between items-baseline">
              <span className="font-medium mono">
                <span className="text-[#f5a524]">{a.event_type}</span> · <span className="text-slate-300">{a.device}</span>
              </span>
              {a.forecast_available ? (
                <span className="mono text-[#37d67a] text-xs">forecast v{a.model_version}</span>
              ) : (
                <span className="mono text-slate-500 text-xs">CEP-only</span>
              )}
            </div>
            <div className="mt-1 mono text-slate-300">
              actual&nbsp;=&nbsp;
              <span className="text-white">{a.actual_avg_temp?.toFixed(2) ?? "—"} °C</span>
              &nbsp;·&nbsp;forecast&nbsp;=&nbsp;
              <span className={a.forecast_available ? "text-[#4dabf7]" : "text-slate-500"}>
                {a.forecast_next_avg_temp?.toFixed(2) ?? "—"} °C
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-400 mono">{a.message}</div>
          </div>
        ))}
        {recent.length === 0 && (
          <div className="px-3 py-6 text-center text-slate-500">
            No enriched alerts yet — waiting for event-of-interest…
          </div>
        )}
      </div>
    </section>
  );
}
